# Architecture: Operational State vs Event History

**Status:** Enforced constraint. All new features must comply.  
**Owner:** Axe (CTO)  
**Version:** 1.0 — team-v17

---

## The Core Rule

> **Operational questions must resolve to operational state tables — never to history tables.**

The platform separates two fundamentally different kinds of data:

| Kind | What it answers | Nature |
|---|---|---|
| **Operational State** | What is true *right now* | Mutable, one row per entity |
| **Event History** | What *happened* over time | Immutable, append-only |

These are not interchangeable. A history table tells you every SMS a client sent. It does not tell you whether that client currently needs a response — that is an operational question.

---

## Table Classification

### Operational State Tables

These tables hold current truth. They get updated in place when state changes.

| Table | What it holds |
|---|---|
| `core.cases` | Current case record: stage, attorney, client, vehicle, jurisdiction |
| `core.case_state` | Extended case state: `intake_status`, sync metadata |
| `core.comms_state` | Per-case SLA state: `awaiting_response`, `unread_count`, `sla_status`, `response_due_at` |
| `core.comms_review_state` | Per-message review state: `needs_review`, `reviewed_by`, `reviewed_at` |
| `core.case_document_checklist` | Per-case document requirements: what is required and its current status |
| `core.document_review_state` | Per-file classification + review state: `is_classified`, `is_reviewed`, `document_type_code` |
| `core.tasks` | Current task record: status, assignee, priority, due date |
| `core.ai_current` | Current AI output per (case, output_type): pointer to latest `ai_outputs` row |

### Event History Tables

These tables record immutable facts. Rows are never updated after insert.

| Table | What it holds |
|---|---|
| `core.events` | Append-only platform event log: `case.created`, `task.completed`, `stage_changed`, etc. |
| `core.communications` | Historical SMS/call/email records: each row is an immutable inbound/outbound fact |
| `core.timeline_notes` | Notes created at a point in time |
| `core.ai_outputs` | All AI runs: immutable record of every model invocation and its output |
| `core.document_files` | Immutable file identity: name, size, URL, upload timestamp, source |

---

## Operational Question → Correct Table

| Question | ✅ Correct table | ❌ Wrong table |
|---|---|---|
| Who currently needs a response? | `core.comms_state.awaiting_response` | `core.communications` |
| Which messages need staff review? | `core.comms_review_state.needs_review` | `core.communications.needs_review` *(deprecated)* |
| What documents are missing? | `core.case_document_checklist` | `core.document_files` |
| What is classified / needs review? | `core.document_review_state` | `core.document_files.is_classified` *(deprecated)* |
| What is the current intake status? | `core.case_state.intake_status` | `core.events` |
| What is the current case stage? | `core.cases.case_status` | `core.events` |
| What tasks are open? | `core.tasks` (status IN open/in_progress/blocked) | `core.events` |
| What is the current AI recommendation? | `core.ai_current` → `core.ai_outputs` | scanning `core.ai_outputs` directly |
| When was this document uploaded? | `core.document_files.created_at` | — ✅ history question, correct table |
| What comms did this client have? | `core.communications` | — ✅ history question, correct table |
| What events happened on this case? | `core.events` | — ✅ history question, correct table |

---

## How State Gets Updated

Operational state tables are updated by **pipelines and triggers**, not raw application code.

```
External event (HubSpot webhook, portal action, cron)
    │
    ▼
core.events (append — immutable fact logged)
    │
    ▼
Pipeline interprets the event
    │
    ├─► core.cases               (stage, attorney, etc.)
    ├─► core.case_state          (intake_status)
    ├─► core.comms_state         (SLA, unread count)
    ├─► core.comms_review_state  (needs_review per message)
    ├─► core.document_review_state (classification, review)
    └─► core.case_document_checklist (checklist status)
```

### DB Triggers (team-v17)

Some state transitions are enforced at the database level to guarantee logging cannot be bypassed:

| Trigger | On | Emits to |
|---|---|---|
| `trg_task_lifecycle_events` | `core.tasks` INSERT/UPDATE | `core.events` |
| `trg_init_comms_review_state` | `core.communications` INSERT | `core.comms_review_state` |
| `trg_init_document_review_state` | `core.document_files` INSERT | `core.document_review_state` |
| `trg_update_ai_current` | `core.ai_outputs` INSERT | `core.ai_current` |

---

## AI Outputs Pattern

```
AI pipeline runs
    │
    ├─► INSERT core.ai_outputs  (immutable: model, input_hash, payload, confidence, generated_at)
    │
    └─► trg_update_ai_current fires
            │
            └─► UPSERT core.ai_current (case_id, output_type) → latest_output_id
```

To get the current AI score for a case:
```sql
SELECT ao.payload, ao.confidence, ao.generated_at
FROM   core.ai_current ac
JOIN   core.ai_outputs ao ON ao.id = ac.latest_output_id
WHERE  ac.case_id = $1 AND ac.output_type = 'qualification_score';
```

Never:
```sql
-- ❌ Do NOT scan ai_outputs for current state
SELECT * FROM core.ai_outputs
WHERE case_id = $1 AND output_type = 'qualification_score'
ORDER BY generated_at DESC LIMIT 1;
```

---

## Deprecation Schedule

Fields being removed in team-v18 (after full API migration):

| Table | Column | Replaced by |
|---|---|---|
| `core.communications` | `needs_review` | `core.comms_review_state.needs_review` |
| `core.document_files` | `is_classified` | `core.document_review_state.is_classified` |
| `core.document_files` | `is_reviewed` | `core.document_review_state.is_reviewed` |
| `core.document_files` | `document_type_code` | `core.document_review_state.document_type_code` |
| `core.document_files` | `classification_source` | `core.document_review_state.classification_source` |
| `core.document_files` | `classified_at` | `core.document_review_state.classified_at` |
| `core.document_files` | `reviewed_at` | `core.document_review_state.reviewed_at` |
| `core.document_files` | `review_notes` | `core.document_review_state.review_notes` |
| `core.ai_outputs` | `is_current` | `core.ai_current` (pointer table) |

---

## Enforcement Rules

1. **No route handler may query a history table to answer a "what is current?" question** when an operational state table exists for it.

2. **All task state transitions emit to `core.events`** via DB trigger — not application code. This cannot be bypassed.

3. **All document classification/review writes go to `core.document_review_state`** — not `core.document_files`.

4. **All comms review state writes go to `core.comms_review_state`** — not `core.communications`.

5. **AI pipeline always inserts to `core.ai_outputs` first** — `core.ai_current` is updated by trigger, never directly.

6. **Violation protocol:** Flag in PR review. Any query pattern `db.from('communications').eq('needs_review', ...)` or `db.from('document_files').eq('is_classified', ...)` is a violation.
