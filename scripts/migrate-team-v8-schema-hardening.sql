-- ============================================================
-- Migration: team-v8 — Schema Hardening
-- ============================================================
-- 1. staff schema — staff_roles + staff_users (required by auth.ts)
-- 2. Fix core.case_documents collision → core.document_files
-- 3. core.tasks
-- 4. ALTER core.cases — assigned_attorney, case_number
-- 5. Comms pipeline trigger → core.comms_state auto-population
-- 6. Backfill core.comms_state from existing communications
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. STAFF SCHEMA
-- ═══════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS staff;

-- ── staff.staff_roles — permission catalog ────────────────────
CREATE TABLE IF NOT EXISTS staff.staff_roles (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name              TEXT        UNIQUE NOT NULL,
  role_level             INT         NOT NULL DEFAULT 0,
    -- Higher = more access. 0=staff, 10=paralegal, 20=manager, 30=attorney, 100=admin
  can_create_cases       BOOLEAN     NOT NULL DEFAULT FALSE,
  can_edit_all_cases     BOOLEAN     NOT NULL DEFAULT FALSE,
  can_delete_cases       BOOLEAN     NOT NULL DEFAULT FALSE,
  can_access_financials  BOOLEAN     NOT NULL DEFAULT FALSE,
  can_manage_staff       BOOLEAN     NOT NULL DEFAULT FALSE,
  can_access_ai_tools    BOOLEAN     NOT NULL DEFAULT FALSE,
  can_approve_settlements BOOLEAN    NOT NULL DEFAULT FALSE,
  description            TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed canonical roles
INSERT INTO staff.staff_roles
  (role_name, role_level, can_create_cases, can_edit_all_cases, can_delete_cases,
   can_access_financials, can_manage_staff, can_access_ai_tools, can_approve_settlements, description)
VALUES
  ('admin',      100, TRUE,  TRUE,  TRUE,  TRUE,  TRUE,  TRUE,  TRUE,  'Full platform access'),
  ('attorney',    30, TRUE,  TRUE,  FALSE, TRUE,  FALSE, TRUE,  TRUE,  'Licensed attorney — case ownership and settlement authority'),
  ('manager',     20, TRUE,  TRUE,  FALSE, TRUE,  TRUE,  TRUE,  FALSE, 'Operations manager — team and case oversight'),
  ('paralegal',   10, FALSE, TRUE,  FALSE, FALSE, FALSE, TRUE,  FALSE, 'Paralegal — case work, no financial access'),
  ('staff',        0, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'General staff — read-only case access')
ON CONFLICT (role_name) DO NOTHING;


-- ── staff.staff_users — canonical staff record ────────────────
-- This is the table auth.ts expects. Must exist before any login.
CREATE TABLE IF NOT EXISTS staff.staff_users (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT        UNIQUE NOT NULL,
  first_name         TEXT,
  last_name          TEXT,
  display_name       TEXT,
  primary_role_id    UUID        REFERENCES staff.staff_roles(id),
  status             TEXT        NOT NULL DEFAULT 'active'
                                 CHECK (status IN ('active','inactive','suspended')),
  azure_ad_object_id TEXT        UNIQUE,
  hubspot_owner_id   TEXT,       -- HubSpot owner ID for assignment sync
  time_zone          TEXT        NOT NULL DEFAULT 'America/Los_Angeles',
  avatar_url         TEXT,
  last_login         TIMESTAMPTZ,
  login_count        INT         NOT NULL DEFAULT 0,
  is_deleted         BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_users_email
  ON staff.staff_users (email) WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_staff_users_role
  ON staff.staff_users (primary_role_id) WHERE is_deleted = FALSE;

-- Seed initial staff (Nov as admin — update password/azure_ad_object_id as needed)
INSERT INTO staff.staff_users (email, first_name, last_name, display_name, primary_role_id, status)
SELECT
  'novaj@rockpointgrowth.com',
  'Novaj',
  'Javidzad',
  'Novaj Javidzad',
  (SELECT id FROM staff.staff_roles WHERE role_name = 'admin'),
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM staff.staff_users WHERE email = 'novaj@rockpointgrowth.com'
);

-- Grants
GRANT USAGE  ON SCHEMA staff TO service_role, authenticated;
GRANT ALL    ON ALL TABLES IN SCHEMA staff TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA staff TO authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 2. FIX core.case_documents COLLISION
-- ═══════════════════════════════════════════════════════════════
-- The team-v6 migration dropped the original SharePoint file-tracking
-- table and replaced it with a minimal workflow state table.
-- That table is redundant with core.case_document_checklist.
-- Drop it (no data) and restore proper file tracking as core.document_files.

DROP TABLE IF EXISTS core.case_documents CASCADE;

-- core.document_files — actual files (SharePoint items, portal uploads)
CREATE TABLE IF NOT EXISTS core.document_files (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id               UUID        NOT NULL REFERENCES core.cases(id) ON DELETE CASCADE,
  checklist_item_id     UUID        REFERENCES core.case_document_checklist(id),
  document_type_code    TEXT        REFERENCES core.document_types(code),

  -- Source
  source                TEXT        NOT NULL DEFAULT 'sharepoint'
                                    CHECK (source IN ('sharepoint','portal_upload','email_attachment','staff_upload')),

  -- SharePoint Graph identity (nullable for non-SharePoint files)
  sharepoint_item_id    TEXT,
  sharepoint_drive_id   TEXT,

  -- File metadata
  file_name             TEXT        NOT NULL,
  file_extension        TEXT,
  size_bytes            BIGINT,
  mime_type             TEXT,

  -- URLs
  web_url               TEXT,
  download_url          TEXT,

  -- Timestamps from source
  created_at_source     TIMESTAMPTZ,
  modified_at_source    TIMESTAMPTZ,

  -- Classification
  is_classified         BOOLEAN     NOT NULL DEFAULT FALSE,
  classified_by         UUID        REFERENCES staff.staff_users(id),
  classified_at         TIMESTAMPTZ,
  classification_source TEXT        CHECK (classification_source IN ('manual','auto','ai')),

  -- Review
  is_reviewed           BOOLEAN     NOT NULL DEFAULT FALSE,
  reviewed_by           UUID        REFERENCES staff.staff_users(id),
  reviewed_at           TIMESTAMPTZ,
  review_notes          TEXT,

  -- Uploader (for non-SharePoint sources)
  uploaded_by           UUID        REFERENCES staff.staff_users(id),

  -- Audit
  synced_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted            BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT document_files_sharepoint_unique
    UNIQUE (case_id, sharepoint_item_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_document_files_case_id
  ON core.document_files (case_id);
CREATE INDEX IF NOT EXISTS idx_document_files_checklist
  ON core.document_files (checklist_item_id) WHERE checklist_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_document_files_type
  ON core.document_files (document_type_code);
CREATE INDEX IF NOT EXISTS idx_document_files_classified
  ON core.document_files (is_classified) WHERE is_classified = FALSE;

GRANT ALL    ON core.document_files TO service_role;
GRANT SELECT ON core.document_files TO authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 3. core.tasks
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS core.tasks (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        UUID        NOT NULL REFERENCES core.cases(id) ON DELETE CASCADE,
  created_by     UUID        REFERENCES staff.staff_users(id),
  assigned_to    UUID        REFERENCES staff.staff_users(id),

  title          TEXT        NOT NULL,
  description    TEXT,
  task_type      TEXT        NOT NULL DEFAULT 'general'
                             CHECK (task_type IN (
                               'general','follow_up','document_request',
                               'demand_letter','settlement','court_filing',
                               'call','email','review','intake_follow_up'
                             )),
  priority       TEXT        NOT NULL DEFAULT 'normal'
                             CHECK (priority IN ('low','normal','high','urgent')),
  task_status    TEXT        NOT NULL DEFAULT 'open'
                             CHECK (task_status IN ('open','in_progress','completed','cancelled')),

  due_at         TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  completed_by   UUID        REFERENCES staff.staff_users(id),
  cancelled_at   TIMESTAMPTZ,
  cancelled_by   UUID        REFERENCES staff.staff_users(id),

  -- Link to the event that created this task (optional)
  source_event_id BIGINT     REFERENCES core.events(id) ON DELETE SET NULL,

  is_deleted     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_case_id
  ON core.tasks (case_id, task_status) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to
  ON core.tasks (assigned_to, task_status) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_tasks_due_at
  ON core.tasks (due_at) WHERE task_status = 'open' AND is_deleted = FALSE;

-- auto-update updated_at
CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON core.tasks
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

GRANT ALL    ON core.tasks TO service_role;
GRANT SELECT ON core.tasks TO authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 4. ALTER core.cases — assigned_attorney + case_number
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE core.cases
  ADD COLUMN IF NOT EXISTS assigned_attorney UUID REFERENCES staff.staff_users(id),
  ADD COLUMN IF NOT EXISTS case_number       TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_cases_assigned_attorney
  ON core.cases (assigned_attorney) WHERE assigned_attorney IS NOT NULL;

-- Auto-generate case_number on INSERT (format: EL-YYYY-NNNNN)
CREATE SEQUENCE IF NOT EXISTS core.case_number_seq START 1;

CREATE OR REPLACE FUNCTION core.generate_case_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.case_number IS NULL THEN
    NEW.case_number := 'EL-' || TO_CHAR(NOW(), 'YYYY') || '-'
      || LPAD(nextval('core.case_number_seq')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_case_number ON core.cases;
CREATE TRIGGER trg_generate_case_number
  BEFORE INSERT ON core.cases
  FOR EACH ROW EXECUTE FUNCTION core.generate_case_number();

-- Backfill case_number for all existing cases (ordered by created_at)
UPDATE core.cases
SET case_number = 'EL-' || TO_CHAR(created_at, 'YYYY') || '-'
  || LPAD(nextval('core.case_number_seq')::TEXT, 5, '0')
WHERE case_number IS NULL
  AND is_deleted = FALSE;


-- ═══════════════════════════════════════════════════════════════
-- 5. COMMS PIPELINE — DB trigger to auto-populate core.comms_state
-- ═══════════════════════════════════════════════════════════════
-- Fires on every INSERT or UPDATE to core.communications.
-- Recalculates comms state for the affected case in real time.

CREATE OR REPLACE FUNCTION core.update_comms_state()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_case_id            UUID;
  v_last_inbound       TIMESTAMPTZ;
  v_last_outbound      TIMESTAMPTZ;
  v_last_inbound_chan   TEXT;
  v_unread_count       INT;
  v_awaiting           BOOLEAN;
  v_sla_hours          INT := 24;
  v_response_due       TIMESTAMPTZ;
  v_sla_status         TEXT;
BEGIN
  v_case_id := COALESCE(NEW.case_id, OLD.case_id);
  IF v_case_id IS NULL THEN RETURN NEW; END IF;

  -- Last inbound + outbound timestamps
  SELECT
    MAX(occurred_at) FILTER (WHERE direction = 'inbound'  AND is_deleted = FALSE),
    MAX(occurred_at) FILTER (WHERE direction = 'outbound' AND is_deleted = FALSE)
  INTO v_last_inbound, v_last_outbound
  FROM core.communications
  WHERE case_id = v_case_id;

  -- Channel of the most recent inbound message
  SELECT channel
  INTO v_last_inbound_chan
  FROM core.communications
  WHERE case_id   = v_case_id
    AND direction = 'inbound'
    AND is_deleted = FALSE
  ORDER BY occurred_at DESC NULLS LAST
  LIMIT 1;

  -- Unread: inbound messages since last outbound (or all inbound if no outbound yet)
  SELECT COUNT(*)
  INTO v_unread_count
  FROM core.communications
  WHERE case_id   = v_case_id
    AND direction = 'inbound'
    AND is_deleted = FALSE
    AND (v_last_outbound IS NULL OR occurred_at > v_last_outbound);

  -- Awaiting response: true when most recent message was inbound
  v_awaiting := (v_last_inbound IS NOT NULL)
    AND (v_last_outbound IS NULL OR v_last_inbound > v_last_outbound);

  -- SLA calculation
  IF v_awaiting AND v_last_inbound IS NOT NULL THEN
    v_response_due := v_last_inbound + (v_sla_hours || ' hours')::INTERVAL;
    v_sla_status   :=
      CASE
        WHEN NOW() > v_response_due                       THEN 'overdue'
        WHEN NOW() > v_response_due - INTERVAL '4 hours' THEN 'due_soon'
        ELSE 'ok'
      END;
  ELSE
    v_response_due := NULL;
    v_sla_status   := CASE WHEN v_last_inbound IS NULL THEN 'no_contact' ELSE 'ok' END;
  END IF;

  INSERT INTO core.comms_state (
    case_id, last_inbound_at, last_outbound_at, last_inbound_channel,
    awaiting_response, response_due_at, sla_status, unread_count, updated_at
  ) VALUES (
    v_case_id, v_last_inbound, v_last_outbound, v_last_inbound_chan,
    v_awaiting, v_response_due, v_sla_status, v_unread_count, NOW()
  )
  ON CONFLICT (case_id) DO UPDATE SET
    last_inbound_at      = EXCLUDED.last_inbound_at,
    last_outbound_at     = EXCLUDED.last_outbound_at,
    last_inbound_channel = EXCLUDED.last_inbound_channel,
    awaiting_response    = EXCLUDED.awaiting_response,
    response_due_at      = EXCLUDED.response_due_at,
    sla_status           = EXCLUDED.sla_status,
    unread_count         = EXCLUDED.unread_count,
    updated_at           = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_comms_state ON core.communications;
CREATE TRIGGER trg_update_comms_state
  AFTER INSERT OR UPDATE ON core.communications
  FOR EACH ROW EXECUTE FUNCTION core.update_comms_state();


-- ═══════════════════════════════════════════════════════════════
-- 6. BACKFILL core.comms_state from existing communications
-- ═══════════════════════════════════════════════════════════════
-- One-time bulk calculation for all cases with existing communications.

INSERT INTO core.comms_state (
  case_id,
  last_inbound_at,
  last_outbound_at,
  last_inbound_channel,
  awaiting_response,
  response_due_at,
  sla_status,
  unread_count,
  updated_at
)
SELECT
  c.case_id,
  MAX(c.occurred_at) FILTER (WHERE c.direction = 'inbound'  AND c.is_deleted = FALSE) AS last_inbound_at,
  MAX(c.occurred_at) FILTER (WHERE c.direction = 'outbound' AND c.is_deleted = FALSE) AS last_outbound_at,
  (
    SELECT channel FROM core.communications x
    WHERE x.case_id = c.case_id AND x.direction = 'inbound' AND x.is_deleted = FALSE
    ORDER BY x.occurred_at DESC NULLS LAST LIMIT 1
  ) AS last_inbound_channel,
  -- awaiting_response
  CASE
    WHEN MAX(c.occurred_at) FILTER (WHERE c.direction = 'inbound' AND c.is_deleted = FALSE) IS NULL
      THEN FALSE
    WHEN MAX(c.occurred_at) FILTER (WHERE c.direction = 'outbound' AND c.is_deleted = FALSE) IS NULL
      THEN TRUE
    WHEN MAX(c.occurred_at) FILTER (WHERE c.direction = 'inbound' AND c.is_deleted = FALSE)
       > MAX(c.occurred_at) FILTER (WHERE c.direction = 'outbound' AND c.is_deleted = FALSE)
      THEN TRUE
    ELSE FALSE
  END AS awaiting_response,
  NULL AS response_due_at,     -- recalculated below
  'ok' AS sla_status,          -- recalculated below
  COUNT(*) FILTER (
    WHERE c.direction = 'inbound'
      AND c.is_deleted = FALSE
      AND (
        MAX(c.occurred_at) FILTER (WHERE c.direction = 'outbound' AND c.is_deleted = FALSE) IS NULL
        OR c.occurred_at > MAX(c.occurred_at) FILTER (WHERE c.direction = 'outbound' AND c.is_deleted = FALSE)
      )
  ) AS unread_count,
  NOW() AS updated_at
FROM core.communications c
WHERE c.case_id IS NOT NULL
GROUP BY c.case_id
ON CONFLICT (case_id) DO UPDATE SET
  last_inbound_at      = EXCLUDED.last_inbound_at,
  last_outbound_at     = EXCLUDED.last_outbound_at,
  last_inbound_channel = EXCLUDED.last_inbound_channel,
  awaiting_response    = EXCLUDED.awaiting_response,
  unread_count         = EXCLUDED.unread_count,
  updated_at           = EXCLUDED.updated_at;

-- Fix SLA status for awaiting cases
UPDATE core.comms_state
SET
  response_due_at = last_inbound_at + INTERVAL '24 hours',
  sla_status = CASE
    WHEN NOW() > last_inbound_at + INTERVAL '24 hours'       THEN 'overdue'
    WHEN NOW() > last_inbound_at + INTERVAL '20 hours'       THEN 'due_soon'
    ELSE 'ok'
  END,
  updated_at = NOW()
WHERE awaiting_response = TRUE
  AND last_inbound_at IS NOT NULL;

-- Mark no_contact cases
UPDATE core.comms_state
SET sla_status = 'no_contact', updated_at = NOW()
WHERE last_inbound_at IS NULL;


-- ═══════════════════════════════════════════════════════════════
-- Realtime on new tables
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE core.tasks REPLICA IDENTITY FULL;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
