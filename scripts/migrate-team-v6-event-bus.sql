-- ============================================================
-- Migration: team-v6 — Event Bus + Operational State Tables
-- ============================================================
-- Run in Supabase SQL Editor (project: nllspzmypvtxewrmsred)
--
-- Creates:
--   core.events          — append-only event log (facts)
--   core.case_state      — pipeline-maintained operational state
--   core.case_documents  — document workflow state
--   core.comms_state     — communication resolution state
--   core.ai_outputs      — structured AI results
-- ============================================================

-- ── core.events ──────────────────────────────────────────────────────────────
-- Append-only. Never UPDATE or DELETE rows here.
-- Events are facts: they represent something that happened.
-- Pipelines read events and update operational state tables.

CREATE TABLE IF NOT EXISTS core.events (
  id           BIGSERIAL    PRIMARY KEY,
  event_type   TEXT         NOT NULL,
  source       TEXT         NOT NULL,         -- 'hubspot_webhook' | 'aloware' | 'portal_ui' | 'cron' | 'system'
  case_id      UUID         REFERENCES core.cases(id) ON DELETE SET NULL,
  actor        TEXT,                          -- user email or system name that triggered the event
  payload      JSONB        NOT NULL DEFAULT '{}',
  occurred_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),  -- when the event actually happened
  recorded_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()   -- when we stored it
);

-- Enforce append-only at the DB level
REVOKE UPDATE ON core.events FROM PUBLIC;
REVOKE DELETE ON core.events FROM PUBLIC;

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_events_case_id_occurred
  ON core.events (case_id, occurred_at DESC)
  WHERE case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_type_occurred
  ON core.events (event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_occurred
  ON core.events (occurred_at DESC);

COMMENT ON TABLE core.events IS
  'Append-only event log. Facts only — never mutated. Pipelines read events and update state tables.';

-- ── core.case_state ───────────────────────────────────────────────────────────
-- Pipeline-maintained operational state derived from events.
-- One row per case. Upserted by pipelines, never by UI directly.

CREATE TABLE IF NOT EXISTS core.case_state (
  case_id            UUID         PRIMARY KEY REFERENCES core.cases(id) ON DELETE CASCADE,
  intake_status      TEXT         DEFAULT 'not_started',
    -- not_started | in_progress | complete | under_review | approved
  intake_batch       INT          DEFAULT 0,
    -- 0 = no batches complete; 1–7 = last completed batch
  docs_status        TEXT         DEFAULT 'not_requested',
    -- not_requested | pending | partial | complete
  comms_status       TEXT         DEFAULT 'no_contact',
    -- active | awaiting_response | stale | no_contact
  urgency_level      TEXT         DEFAULT 'normal',
    -- normal | attention | critical
  next_action        TEXT,
  next_action_due    TIMESTAMPTZ,
  last_event_at      TIMESTAMPTZ,
  last_event_type    TEXT,
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_state_urgency
  ON core.case_state (urgency_level)
  WHERE urgency_level != 'normal';

CREATE INDEX IF NOT EXISTS idx_case_state_intake
  ON core.case_state (intake_status);

COMMENT ON TABLE core.case_state IS
  'Operational state per case — derived by pipelines from events. Source of truth for workflow status.';

-- ── core.case_documents ───────────────────────────────────────────────────────
-- Document workflow state. One row per document per case.

CREATE TABLE IF NOT EXISTS core.case_documents (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        UUID         NOT NULL REFERENCES core.cases(id) ON DELETE CASCADE,
  document_type  TEXT         NOT NULL,
    -- repair_order | purchase_agreement | warranty | title | registration | demand_letter | other
  status         TEXT         NOT NULL DEFAULT 'requested',
    -- requested | uploaded | classified | reviewed | accepted | rejected
  file_name      TEXT,
  sharepoint_url TEXT,
  mime_type      TEXT,
  file_size_bytes BIGINT,
  uploaded_at    TIMESTAMPTZ,
  reviewed_at    TIMESTAMPTZ,
  reviewed_by    TEXT,
  rejection_reason TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_documents_case_id
  ON core.case_documents (case_id, status);

CREATE INDEX IF NOT EXISTS idx_case_documents_status
  ON core.case_documents (status)
  WHERE status NOT IN ('accepted');

COMMENT ON TABLE core.case_documents IS
  'Document workflow state per case. Tracks each document from requested → accepted/rejected.';

-- ── core.comms_state ─────────────────────────────────────────────────────────
-- Communication SLA and resolution state. One row per case.

CREATE TABLE IF NOT EXISTS core.comms_state (
  case_id             UUID         PRIMARY KEY REFERENCES core.cases(id) ON DELETE CASCADE,
  last_inbound_at     TIMESTAMPTZ,
  last_outbound_at    TIMESTAMPTZ,
  last_inbound_channel TEXT,        -- sms | email | call | voicemail
  awaiting_response   BOOLEAN      NOT NULL DEFAULT FALSE,
  response_due_at     TIMESTAMPTZ,
  sla_hours           INT          DEFAULT 24,
  sla_status          TEXT         DEFAULT 'ok',
    -- ok | due_soon | overdue | no_contact
  unread_count        INT          NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comms_state_sla
  ON core.comms_state (sla_status)
  WHERE sla_status != 'ok';

CREATE INDEX IF NOT EXISTS idx_comms_state_awaiting
  ON core.comms_state (awaiting_response, response_due_at)
  WHERE awaiting_response = TRUE;

COMMENT ON TABLE core.comms_state IS
  'Communication SLA and resolution state per case. Updated by the comms pipeline.';

-- ── core.ai_outputs ───────────────────────────────────────────────────────────
-- Structured AI results. Multiple outputs per case.
-- Narrative text is secondary — structured payload drives the platform.

CREATE TABLE IF NOT EXISTS core.ai_outputs (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      UUID         NOT NULL REFERENCES core.cases(id) ON DELETE CASCADE,
  event_id     BIGINT       REFERENCES core.events(id) ON DELETE SET NULL,
    -- the event that triggered this AI run (nullable for manually triggered runs)
  output_type  TEXT         NOT NULL,
    -- case_strength | urgency_flag | next_action | doc_classification
    -- field_extraction | evidence_gap | demand_estimate | case_summary
  model        TEXT,
  confidence   NUMERIC(4,3) CHECK (confidence >= 0 AND confidence <= 1),
  payload      JSONB        NOT NULL DEFAULT '{}',
    -- structured fields specific to output_type; always machine-readable
  narrative    TEXT,
    -- human-readable summary (optional, secondary)
  is_current   BOOLEAN      NOT NULL DEFAULT TRUE,
    -- false when superseded by a newer output of the same type
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_outputs_case_type
  ON core.ai_outputs (case_id, output_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_outputs_current
  ON core.ai_outputs (case_id, output_type)
  WHERE is_current = TRUE;

COMMENT ON TABLE core.ai_outputs IS
  'Structured AI results per case. payload is always machine-readable. narrative is optional human text.';

-- ── Auto-timestamp trigger for updated_at ─────────────────────────────────────
CREATE OR REPLACE FUNCTION core.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_case_state_updated_at
  BEFORE UPDATE ON core.case_state
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_case_documents_updated_at
  BEFORE UPDATE ON core.case_documents
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

CREATE TRIGGER trg_comms_state_updated_at
  BEFORE UPDATE ON core.comms_state
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- ── Supersede old AI outputs when a new one is inserted ───────────────────────
CREATE OR REPLACE FUNCTION core.supersede_ai_output()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE core.ai_outputs
  SET is_current = FALSE
  WHERE case_id    = NEW.case_id
    AND output_type = NEW.output_type
    AND id          != NEW.id
    AND is_current  = TRUE;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_supersede_ai_output
  AFTER INSERT ON core.ai_outputs
  FOR EACH ROW EXECUTE FUNCTION core.supersede_ai_output();

-- ── Enable Realtime on new tables ─────────────────────────────────────────────
ALTER TABLE core.case_state     REPLICA IDENTITY FULL;
ALTER TABLE core.comms_state    REPLICA IDENTITY FULL;
ALTER TABLE core.ai_outputs     REPLICA IDENTITY FULL;
-- NOTE: final working REVOKE syntax for Supabase:
-- REVOKE UPDATE, DELETE ON core.events FROM authenticated, anon;
