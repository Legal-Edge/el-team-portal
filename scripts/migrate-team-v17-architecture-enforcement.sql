-- ============================================================
-- Migration: team-v17 — Architecture Enforcement
-- Operational State vs Event History separation
-- ============================================================
-- Rule: Operational questions resolve to operational state tables.
--       History tables are immutable facts. Never query history
--       to answer a "what is current?" question.
--
-- Changes:
--   1. Task lifecycle triggers → core.events (append-only)
--   2. core.comms_review_state — moves needs_review off core.communications
--   3. core.document_review_state — moves classification/review state off core.document_files
--   4. core.ai_current — current-pointer table for core.ai_outputs
--   5. Updated views: documents_queue, case_doc_summary
--   6. Realtime publication for new state tables
-- ============================================================

-- ╔══════════════════════════════════════════════════════════════╗
-- ║  1. TASK LIFECYCLE TRIGGERS → core.events                  ║
-- ╚══════════════════════════════════════════════════════════════╝
-- DB triggers ensure no task state transition can bypass event logging.
-- Emits: task.created, task.status_changed, task.completed, task.cancelled

CREATE OR REPLACE FUNCTION core.emit_task_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- INSERT → task.created
  IF TG_OP = 'INSERT' THEN
    INSERT INTO core.events (event_type, source, case_id, actor, payload)
    VALUES (
      'task.created',
      'portal_ui',
      NEW.case_id,
      NEW.created_by::TEXT,
      jsonb_build_object(
        'task_id',    NEW.id,
        'title',      NEW.title,
        'task_type',  NEW.task_type,
        'priority',   NEW.priority,
        'assigned_to', NEW.assigned_to,
        'due_at',     NEW.due_at
      )
    );

  -- UPDATE of task_status → task.status_changed / completed / cancelled
  ELSIF TG_OP = 'UPDATE' AND OLD.task_status IS DISTINCT FROM NEW.task_status THEN
    INSERT INTO core.events (event_type, source, case_id, actor, payload)
    VALUES (
      CASE
        WHEN NEW.task_status = 'completed' THEN 'task.completed'
        WHEN NEW.task_status = 'cancelled' THEN 'task.cancelled'
        ELSE 'task.status_changed'
      END,
      'portal_ui',
      NEW.case_id,
      COALESCE(NEW.completed_by, NEW.cancelled_by, NEW.assigned_to)::TEXT,
      jsonb_build_object(
        'task_id',      NEW.id,
        'title',        NEW.title,
        'task_type',    NEW.task_type,
        'from_status',  OLD.task_status,
        'to_status',    NEW.task_status,
        'assigned_to',  NEW.assigned_to,
        'priority',     NEW.priority
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_lifecycle_events ON core.tasks;
CREATE TRIGGER trg_task_lifecycle_events
  AFTER INSERT OR UPDATE ON core.tasks
  FOR EACH ROW
  WHEN (NEW.is_deleted = FALSE)
  EXECUTE FUNCTION core.emit_task_event();

-- ╔══════════════════════════════════════════════════════════════╗
-- ║  2. core.comms_review_state                                ║
-- ╚══════════════════════════════════════════════════════════════╝
-- Moves the mutable needs_review flag off core.communications.
-- core.communications rows become immutable historical facts.
-- Operational question: "which messages need review?" → this table.

CREATE TABLE IF NOT EXISTS core.comms_review_state (
  comm_id      UUID        PRIMARY KEY
                           REFERENCES core.communications(id) ON DELETE CASCADE,
  needs_review BOOLEAN     NOT NULL DEFAULT TRUE,
  reviewed_by  UUID        REFERENCES staff.staff_users(id),
  reviewed_at  TIMESTAMPTZ,
  review_notes TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE core.comms_review_state IS
  'Per-message review state. Operational truth for "which messages need review?".
   core.communications rows are immutable; this table holds the mutable flag.';

-- Backfill from existing needs_review on communications
INSERT INTO core.comms_review_state (comm_id, needs_review)
SELECT id, needs_review
FROM   core.communications
WHERE  is_deleted = FALSE
ON CONFLICT (comm_id) DO NOTHING;

-- Auto-create review state row on every new communication INSERT
CREATE OR REPLACE FUNCTION core.init_comms_review_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO core.comms_review_state (comm_id, needs_review)
  VALUES (
    NEW.id,
    -- Inbound messages need review by default; outbound do not
    CASE WHEN NEW.direction = 'inbound' THEN TRUE ELSE FALSE END
  )
  ON CONFLICT (comm_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_init_comms_review_state ON core.communications;
CREATE TRIGGER trg_init_comms_review_state
  AFTER INSERT ON core.communications
  FOR EACH ROW
  EXECUTE FUNCTION core.init_comms_review_state();

-- Index for "needs review" count queries
CREATE INDEX IF NOT EXISTS idx_comms_review_state_needs
  ON core.comms_review_state (needs_review)
  WHERE needs_review = TRUE;

-- DEPRECATION NOTE: core.communications.needs_review is now deprecated.
-- It will be dropped in team-v18 after all queries are migrated.
-- Do NOT write to communications.needs_review for new code.
COMMENT ON COLUMN core.communications.needs_review IS
  'DEPRECATED: use core.comms_review_state.needs_review instead. Will be dropped in team-v18.';

-- ╔══════════════════════════════════════════════════════════════╗
-- ║  3. core.document_review_state                             ║
-- ╚══════════════════════════════════════════════════════════════╝
-- Moves classification + review state off core.document_files.
-- core.document_files becomes the immutable file identity record.
-- document_type_code moves here because it is assigned during classification
-- (it is classification state, not part of the immutable file identity).
-- Operational questions: "what is classified?" "what needs review?" → this table.

CREATE TABLE IF NOT EXISTS core.document_review_state (
  doc_id                UUID        PRIMARY KEY
                                    REFERENCES core.document_files(id) ON DELETE CASCADE,

  -- Classification state
  is_classified         BOOLEAN     NOT NULL DEFAULT FALSE,
  document_type_code    TEXT        REFERENCES core.document_types(code),
  classification_source TEXT        CHECK (classification_source IN ('manual','auto','ai','rule')),
  classified_at         TIMESTAMPTZ,
  classified_by         UUID        REFERENCES staff.staff_users(id),

  -- Review state
  is_reviewed           BOOLEAN     NOT NULL DEFAULT FALSE,
  reviewed_at           TIMESTAMPTZ,
  reviewed_by           UUID        REFERENCES staff.staff_users(id),
  review_notes          TEXT,

  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE core.document_review_state IS
  'Per-document classification and review state. Operational truth for "what docs are classified/reviewed?".
   core.document_files is the immutable file record; this table holds mutable state.
   document_type_code lives here because it is assigned during classification, not ingestion.';

-- Backfill from existing fields on document_files
INSERT INTO core.document_review_state (
  doc_id, is_classified, document_type_code, classification_source,
  classified_at, is_reviewed, reviewed_at, review_notes
)
SELECT
  df.id,
  df.is_classified,
  df.document_type_code,
  df.classification_source,
  df.classified_at,
  df.is_reviewed,
  df.reviewed_at,
  df.review_notes
FROM core.document_files df
WHERE df.is_deleted = FALSE
ON CONFLICT (doc_id) DO NOTHING;

-- Auto-create review state row on every new document_files INSERT
CREATE OR REPLACE FUNCTION core.init_document_review_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO core.document_review_state (doc_id)
  VALUES (NEW.id)
  ON CONFLICT (doc_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_init_document_review_state ON core.document_files;
CREATE TRIGGER trg_init_document_review_state
  AFTER INSERT ON core.document_files
  FOR EACH ROW
  EXECUTE FUNCTION core.init_document_review_state();

-- Indexes for queue sort + filter patterns
CREATE INDEX IF NOT EXISTS idx_doc_review_state_queue
  ON core.document_review_state (is_reviewed, is_classified, classified_at DESC);

CREATE INDEX IF NOT EXISTS idx_doc_review_state_classified
  ON core.document_review_state (is_classified)
  WHERE is_classified = FALSE;

-- DEPRECATION NOTE: classification/review fields on core.document_files are now deprecated.
-- They will be dropped in team-v18.
COMMENT ON COLUMN core.document_files.is_classified IS
  'DEPRECATED: use core.document_review_state.is_classified. Will be dropped in team-v18.';
COMMENT ON COLUMN core.document_files.is_reviewed IS
  'DEPRECATED: use core.document_review_state.is_reviewed. Will be dropped in team-v18.';
COMMENT ON COLUMN core.document_files.document_type_code IS
  'DEPRECATED: use core.document_review_state.document_type_code. Will be dropped in team-v18.';

-- ╔══════════════════════════════════════════════════════════════╗
-- ║  4. core.ai_current — current AI output pointer            ║
-- ╚══════════════════════════════════════════════════════════════╝
-- core.ai_outputs = immutable history of all AI runs.
-- core.ai_current = one row per (case, output_type) pointing to the latest.
-- Operational question: "what is the current AI score?" → ai_current → ai_outputs.
-- Never scan ai_outputs directly for current state.

CREATE TABLE IF NOT EXISTS core.ai_current (
  case_id          UUID  NOT NULL REFERENCES core.cases(id)      ON DELETE CASCADE,
  output_type      TEXT  NOT NULL,
  latest_output_id UUID  NOT NULL REFERENCES core.ai_outputs(id) ON DELETE CASCADE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (case_id, output_type)
);

COMMENT ON TABLE core.ai_current IS
  'Current AI output per (case, output_type). One row per type per case.
   Operational truth for "what is the current AI recommendation?".
   Always updated atomically when a new ai_outputs row is inserted.
   core.ai_outputs remains append-only history.';

CREATE INDEX IF NOT EXISTS idx_ai_current_case
  ON core.ai_current (case_id);

-- Auto-update ai_current when a new ai_outputs row is inserted
-- (is_current flag on ai_outputs is now read-only / informational only)
CREATE OR REPLACE FUNCTION core.update_ai_current()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Upsert: set this as the current output for (case, type)
  INSERT INTO core.ai_current (case_id, output_type, latest_output_id, updated_at)
  VALUES (NEW.case_id, NEW.output_type, NEW.id, NOW())
  ON CONFLICT (case_id, output_type)
  DO UPDATE SET
    latest_output_id = EXCLUDED.latest_output_id,
    updated_at       = NOW();

  -- Mark the previous current row as superseded (is_current remains for audit)
  UPDATE core.ai_outputs
  SET    is_current = FALSE
  WHERE  case_id    = NEW.case_id
    AND  output_type = NEW.output_type
    AND  id         != NEW.id
    AND  is_current = TRUE;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_ai_current ON core.ai_outputs;
CREATE TRIGGER trg_update_ai_current
  AFTER INSERT ON core.ai_outputs
  FOR EACH ROW
  EXECUTE FUNCTION core.update_ai_current();

-- ╔══════════════════════════════════════════════════════════════╗
-- ║  5. Rebuilt views using operational state tables           ║
-- ╚══════════════════════════════════════════════════════════════╝

-- ── core.documents_queue — now reads classification/review from document_review_state
CREATE OR REPLACE VIEW core.documents_queue AS
SELECT
  df.id                                           AS doc_id,
  df.case_id,
  ca.case_number,
  ca.case_status,
  ca.hubspot_deal_id,
  ca.assigned_attorney,
  su_atty.display_name                            AS attorney_name,

  TRIM(CONCAT(
    COALESCE(co.first_name, ca.client_first_name, ''), ' ',
    COALESCE(co.last_name,  ca.client_last_name,  '')
  ))                                              AS client_full_name,
  COALESCE(co.phone, ca.client_phone)             AS client_phone,

  -- Immutable file identity (from document_files)
  df.file_name,
  df.file_extension,
  df.source,
  df.web_url,
  df.size_bytes,
  df.created_at_source,
  df.synced_at,
  df.created_at,

  -- Classification + review state (from document_review_state — operational)
  COALESCE(drs.is_classified, FALSE)              AS is_classified,
  drs.document_type_code,
  drs.classification_source,
  drs.classified_at,
  su_class.display_name                           AS classified_by_name,
  COALESCE(drs.is_reviewed, FALSE)                AS is_reviewed,
  drs.review_notes,
  drs.reviewed_at,
  su_rev.display_name                             AS reviewed_by_name,

  -- Checklist expected status
  cl.status                                       AS checklist_status,

  -- Sort: 1=unclassified, 2=classified+needs review, 3=reviewed
  CASE
    WHEN COALESCE(drs.is_reviewed, FALSE) = FALSE
     AND COALESCE(drs.is_classified, FALSE) = FALSE THEN 1
    WHEN COALESCE(drs.is_reviewed, FALSE) = FALSE
     AND COALESCE(drs.is_classified, FALSE) = TRUE  THEN 2
    WHEN COALESCE(drs.is_reviewed, FALSE) = TRUE    THEN 3
    ELSE 4
  END                                             AS review_sort

FROM core.document_files df
JOIN core.cases ca
  ON ca.id = df.case_id AND ca.is_deleted = FALSE
LEFT JOIN core.document_review_state drs
  ON drs.doc_id = df.id
LEFT JOIN core.case_contacts cc
  ON cc.case_id = ca.id AND cc.is_primary = TRUE AND cc.is_deleted = FALSE
LEFT JOIN core.contacts co
  ON co.id = cc.contact_id
LEFT JOIN staff.staff_users su_atty
  ON su_atty.id = ca.assigned_attorney
LEFT JOIN staff.staff_users su_rev
  ON su_rev.id = drs.reviewed_by
LEFT JOIN staff.staff_users su_class
  ON su_class.id = drs.classified_by
LEFT JOIN core.case_document_checklist cl
  ON cl.id = df.checklist_item_id
WHERE df.is_deleted = FALSE;

GRANT SELECT ON core.documents_queue TO service_role, authenticated;

-- ── core.case_doc_summary — now reads from document_review_state
CREATE OR REPLACE VIEW core.case_doc_summary AS
WITH doc_counts AS (
  SELECT
    df.case_id,
    COUNT(df.id)                                                               AS total_docs,
    COUNT(df.id) FILTER (WHERE COALESCE(drs.is_classified, FALSE) = FALSE)     AS unclassified,
    COUNT(df.id) FILTER (WHERE COALESCE(drs.is_classified, FALSE) = TRUE
                           AND COALESCE(drs.is_reviewed,   FALSE) = FALSE)     AS needs_review,
    MAX(df.created_at) FILTER (
      WHERE df.created_at >= NOW() - INTERVAL '24h'
    )                                                                           AS recent_upload_at
  FROM core.document_files df
  LEFT JOIN core.document_review_state drs ON drs.doc_id = df.id
  WHERE df.is_deleted = FALSE
  GROUP BY df.case_id
),
checklist_counts AS (
  SELECT
    case_id,
    COUNT(id) FILTER (
      WHERE status IN ('required', 'requested') AND is_required = TRUE
    )                                                                           AS missing_required
  FROM core.case_document_checklist
  WHERE is_deleted = FALSE
  GROUP BY case_id
)
SELECT
  d.case_id,
  d.total_docs,
  d.unclassified,
  d.needs_review,
  COALESCE(c.missing_required, 0)  AS missing_required,
  d.recent_upload_at
FROM doc_counts d
LEFT JOIN checklist_counts c ON c.case_id = d.case_id;

GRANT SELECT ON core.case_doc_summary TO service_role, authenticated;

-- ╔══════════════════════════════════════════════════════════════╗
-- ║  6. Realtime publication for new state tables              ║
-- ╚══════════════════════════════════════════════════════════════╝

ALTER TABLE core.comms_review_state    REPLICA IDENTITY FULL;
ALTER TABLE core.document_review_state REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'core' AND tablename = 'comms_review_state'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE core.comms_review_state;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'core' AND tablename = 'document_review_state'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE core.document_review_state;
  END IF;
END $$;

-- ╔══════════════════════════════════════════════════════════════╗
-- ║  7. Permissions                                            ║
-- ╚══════════════════════════════════════════════════════════════╝

GRANT SELECT, INSERT, UPDATE ON core.comms_review_state    TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE ON core.document_review_state TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE ON core.ai_current            TO service_role, authenticated;

-- ╔══════════════════════════════════════════════════════════════╗
-- ║  8. Verify                                                 ║
-- ╚══════════════════════════════════════════════════════════════╝

SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'core'
ORDER BY tablename;

NOTIFY pgrst, 'reload schema';
