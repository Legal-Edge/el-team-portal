-- ============================================================
-- Migration: team-v10 — Intake Session Hardening
-- ============================================================
-- Replaces the flat, HubSpot-field-dump model (core.case_intake)
-- with a proper session-based structure:
--
--   core.intake_sessions     — session envelope + typed intake fields
--   core.intake_batches      — per-batch completion tracking (7 rows/session)
--   core.intake_problems     — child table for problems 1–4
--
-- core.case_intake is deprecated (not dropped) — receives a
-- migrated_to_session_id pointer for audit trail.
--
-- Batch completion auto-advances core.case_state.intake_status
-- via DB trigger. Staff-set statuses (under_review and beyond)
-- are never overwritten by the trigger.
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. core.intake_sessions
-- ═══════════════════════════════════════════════════════════════
-- Vehicle identity (year/make/model/mileage/VIN) is NOT duplicated
-- here — it lives on core.cases and is synced from HubSpot.
-- intake_sessions stores questionnaire-specific context only.

CREATE TABLE IF NOT EXISTS core.intake_sessions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Case + contact linkage ──────────────────────────────────
  case_id          UUID        NOT NULL REFERENCES core.cases(id) ON DELETE CASCADE,
  contact_id       UUID        REFERENCES core.contacts(id),

  -- ── Session identity ────────────────────────────────────────
  session_number   INT         NOT NULL DEFAULT 1,   -- increments on re-open
  is_current       BOOLEAN     NOT NULL DEFAULT TRUE, -- only one TRUE per case
  source           TEXT        NOT NULL DEFAULT 'portal'
                               CHECK (source IN ('portal','staff_manual','import','backfill')),
  status           TEXT        NOT NULL DEFAULT 'in_progress'
                               CHECK (status IN (
                                 'in_progress','submitted','under_review',
                                 'docs_needed','attorney_review','approved','rejected'
                               )),

  -- ── Submission + review timestamps ─────────────────────────
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at     TIMESTAMPTZ,
  reviewed_at      TIMESTAMPTZ,
  reviewed_by      UUID        REFERENCES staff.staff_users(id),
  review_notes     TEXT,

  -- ── Portal session metadata ─────────────────────────────────
  ip_address       TEXT,
  user_agent       TEXT,

  -- ── Purchase / ownership ───────────────────────────────────
  -- vehicle_year/make/model/mileage/vin stay on core.cases
  purchase_or_lease TEXT       CHECK (purchase_or_lease IN ('purchase','lease')),
  how_purchased    TEXT        CHECK (how_purchased IN ('dealer','private_party','cpo','other')),
  vehicle_status   TEXT        CHECK (vehicle_status IN (
                                 'have_vehicle','traded_in','sold','totaled','other'
                               )),

  -- ── Repair history ─────────────────────────────────────────
  had_repairs              BOOLEAN,
  paid_for_repairs         BOOLEAN,
  repair_count             INT,
  repair_attempts          INT,        -- total attempts across all problems
  last_repair_attempt_date DATE,
  in_shop_30_days          BOOLEAN,    -- ever in shop 30+ consecutive days

  -- ── Manufacturer contact ───────────────────────────────────
  contacted_manufacturer  BOOLEAN,
  manufacturer_offer      TEXT,

  -- ── Documents ──────────────────────────────────────────────
  has_repair_documents    BOOLEAN,

  -- ── Outcome preference ─────────────────────────────────────
  refund_preference       TEXT        CHECK (refund_preference IN (
                                        'buyback','cash_settlement','replacement','undecided'
                                      )),

  -- ── Audit ──────────────────────────────────────────────────
  is_deleted       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT intake_sessions_case_session_unique UNIQUE (case_id, session_number)
);

-- Only one current session per case
CREATE UNIQUE INDEX IF NOT EXISTS uidx_intake_sessions_current
  ON core.intake_sessions (case_id)
  WHERE is_current = TRUE AND is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_intake_sessions_case_id
  ON core.intake_sessions (case_id);
CREATE INDEX IF NOT EXISTS idx_intake_sessions_contact_id
  ON core.intake_sessions (contact_id)
  WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_intake_sessions_status
  ON core.intake_sessions (status)
  WHERE is_current = TRUE AND is_deleted = FALSE;

CREATE TRIGGER trg_intake_sessions_updated_at
  BEFORE UPDATE ON core.intake_sessions
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

GRANT ALL    ON core.intake_sessions TO service_role;
GRANT SELECT ON core.intake_sessions TO authenticated;
ALTER TABLE core.intake_sessions REPLICA IDENTITY FULL;


-- ═══════════════════════════════════════════════════════════════
-- 2. core.intake_batches
-- ═══════════════════════════════════════════════════════════════
-- One row per batch per session. This is the batch completion
-- source of truth — replaces el_app_status as the batch tracker.
--
-- Batch reference:
--   1 — Vehicle & Purchase Details
--   2 — Vehicle Problems
--   3 — Repair History
--   4 — Manufacturer Contact
--   5 — Documents
--   6 — Refund Preference
--   7 — Final Review / Submission

CREATE TABLE IF NOT EXISTS core.intake_batches (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID        NOT NULL REFERENCES core.intake_sessions(id) ON DELETE CASCADE,
  batch_number   INT         NOT NULL CHECK (batch_number BETWEEN 1 AND 7),
  status         TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','in_progress','completed','skipped')),
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT intake_batches_session_batch_unique UNIQUE (session_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_intake_batches_session_id
  ON core.intake_batches (session_id);
CREATE INDEX IF NOT EXISTS idx_intake_batches_completed
  ON core.intake_batches (session_id, batch_number)
  WHERE status = 'completed';

CREATE TRIGGER trg_intake_batches_updated_at
  BEFORE UPDATE ON core.intake_batches
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

GRANT ALL    ON core.intake_batches TO service_role;
GRANT SELECT ON core.intake_batches TO authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 3. core.intake_problems
-- ═══════════════════════════════════════════════════════════════
-- Replaces problem_1_* / problem_2_* / problem_3_* / problem_4_*
-- ad-hoc columns on core.case_intake.

CREATE TABLE IF NOT EXISTS core.intake_problems (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID        NOT NULL REFERENCES core.intake_sessions(id) ON DELETE CASCADE,
  problem_number   INT         NOT NULL CHECK (problem_number BETWEEN 1 AND 4),
  category         TEXT,       -- 'engine','transmission','electrical','brakes','other', etc.
  description      TEXT,       -- free-text description of the problem
  repair_attempts  INT,        -- how many times dealer attempted to fix this problem
  is_ongoing       BOOLEAN,    -- problem still present at time of submission
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT intake_problems_session_number_unique UNIQUE (session_id, problem_number)
);

CREATE INDEX IF NOT EXISTS idx_intake_problems_session_id
  ON core.intake_problems (session_id);

CREATE TRIGGER trg_intake_problems_updated_at
  BEFORE UPDATE ON core.intake_problems
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

GRANT ALL    ON core.intake_problems TO service_role;
GRANT SELECT ON core.intake_problems TO authenticated;


-- ═══════════════════════════════════════════════════════════════
-- 4. BATCH COMPLETION TRIGGER → core.case_state.intake_status
-- ═══════════════════════════════════════════════════════════════
-- Fires on every INSERT or UPDATE to core.intake_batches.
-- Maps completed batch count → intake_status and updates case_state.
--
-- CRITICAL RULE: only advances statuses in the batch_N_needed range.
-- If intake_status is already under_review, docs_needed, attorney_review,
-- case_approved, or beyond — the trigger does NOT overwrite it.
-- Those are staff-controlled transitions.

CREATE OR REPLACE FUNCTION core.sync_intake_status_from_batches()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_case_id         UUID;
  v_completed       INT;
  v_current_status  TEXT;
  v_new_status      TEXT;
BEGIN
  -- Resolve case_id from session
  SELECT s.case_id INTO v_case_id
  FROM core.intake_sessions s
  WHERE s.id = NEW.session_id AND s.is_current = TRUE;

  IF v_case_id IS NULL THEN RETURN NEW; END IF;

  -- Count completed batches for this session
  SELECT COUNT(*) INTO v_completed
  FROM core.intake_batches
  WHERE session_id = NEW.session_id AND status = 'completed';

  -- Current intake_status from case_state
  SELECT intake_status INTO v_current_status
  FROM core.case_state
  WHERE case_id = v_case_id;

  -- Only advance if currently in the batch_N_needed range or not_started.
  -- Never overwrite under_review, docs_needed, attorney_review, case_approved,
  -- legal_case_active, legal_case_resolved — those are staff territory.
  IF v_current_status NOT IN (
    'not_started',
    'intake_batch_1_needed', 'intake_batch_2_needed', 'intake_batch_3_needed',
    'intake_batch_4_needed', 'intake_batch_5_needed', 'intake_batch_6_needed',
    'intake_batch_7_needed'
  ) THEN
    RETURN NEW;
  END IF;

  -- Map completed count → next status
  v_new_status :=
    CASE v_completed
      WHEN 0 THEN 'intake_batch_1_needed'
      WHEN 1 THEN 'intake_batch_2_needed'
      WHEN 2 THEN 'intake_batch_3_needed'
      WHEN 3 THEN 'intake_batch_4_needed'
      WHEN 4 THEN 'intake_batch_5_needed'
      WHEN 5 THEN 'intake_batch_6_needed'
      WHEN 6 THEN 'intake_batch_7_needed'
      ELSE        'intake_under_review'   -- all 7 completed
    END;

  -- Only write if status actually changed (avoid spurious events)
  IF v_new_status = v_current_status THEN RETURN NEW; END IF;

  -- Update case_state
  INSERT INTO core.case_state (case_id, intake_status, updated_at)
  VALUES (v_case_id, v_new_status, NOW())
  ON CONFLICT (case_id) DO UPDATE SET
    intake_status = EXCLUDED.intake_status,
    updated_at    = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_intake_status ON core.intake_batches;
CREATE TRIGGER trg_sync_intake_status
  AFTER INSERT OR UPDATE ON core.intake_batches
  FOR EACH ROW EXECUTE FUNCTION core.sync_intake_status_from_batches();


-- ═══════════════════════════════════════════════════════════════
-- 5. BACKFILL — migrate core.case_intake → new structure
-- ═══════════════════════════════════════════════════════════════
-- For each case_intake row:
--   a) Create an intake_session (source = 'backfill')
--   b) Determine completed batch count from core.cases.el_app_status
--   c) Create intake_batch rows for completed batches
--   d) Create intake_problem rows from problem_1–4 columns

-- Step 5a: Create sessions from existing case_intake rows
WITH
-- Map el_app_status → number of completed batches
status_to_batches AS (
  SELECT
    ci.case_id,
    ci.had_repairs,
    -- Coerce text fields to proper types
    CASE WHEN LOWER(ci.paid_for_repairs) IN ('yes','true','1') THEN TRUE
         WHEN LOWER(ci.paid_for_repairs) IN ('no','false','0') THEN FALSE
         ELSE NULL END                                            AS paid_for_repairs,
    CASE WHEN ci.repair_count ~ '^\d+$'
         THEN ci.repair_count::INT ELSE NULL END                  AS repair_count,
    CASE WHEN ci.repair_attempts ~ '^\d+$'
         THEN ci.repair_attempts::INT ELSE NULL END               AS repair_attempts,
    ci.last_repair_attempt_date,
    CASE WHEN LOWER(ci.in_shop_30_days) IN ('yes','true','1') THEN TRUE
         WHEN LOWER(ci.in_shop_30_days) IN ('no','false','0') THEN FALSE
         ELSE NULL END                                            AS in_shop_30_days,
    CASE WHEN LOWER(ci.contacted_manufacturer) IN ('yes','true','1') THEN TRUE
         WHEN LOWER(ci.contacted_manufacturer) IN ('no','false','0') THEN FALSE
         ELSE NULL END                                            AS contacted_manufacturer,
    ci.manufacturer_offer,
    CASE WHEN LOWER(ci.has_repair_documents) IN ('yes','true','1') THEN TRUE
         WHEN LOWER(ci.has_repair_documents) IN ('no','false','0') THEN FALSE
         ELSE NULL END                                            AS has_repair_documents,
    CASE
      WHEN ci.purchase_or_lease ILIKE '%lease%' THEN 'lease'
      WHEN ci.purchase_or_lease ILIKE '%purchase%' OR ci.purchase_or_lease ILIKE '%buy%' THEN 'purchase'
      ELSE NULL
    END                                                           AS purchase_or_lease,
    ci.vehicle_status,
    ci.refund_preference,
    -- Completed batches from el_app_status
    CASE c.el_app_status
      WHEN 'not_started'            THEN 0
      WHEN 'intake_batch_1_needed'  THEN 0
      WHEN 'intake_batch_2_needed'  THEN 1
      WHEN 'intake_batch_3_needed'  THEN 2
      WHEN 'intake_batch_4_needed'  THEN 3
      WHEN 'intake_batch_5_needed'  THEN 4
      WHEN 'intake_batch_6_needed'  THEN 5
      WHEN 'intake_batch_7_needed'  THEN 6
      ELSE 7  -- under_review and beyond = all batches done
    END                                                           AS completed_batch_count,
    ci.id                                                         AS source_intake_id,
    ci.created_at,
    ci.updated_at
  FROM core.case_intake ci
  JOIN core.cases c ON c.id = ci.case_id
  WHERE ci.case_id NOT IN (
    SELECT case_id FROM core.intake_sessions WHERE is_deleted = FALSE
  )
),

-- Step 5a: Insert sessions, capture new IDs
inserted_sessions AS (
  INSERT INTO core.intake_sessions (
    case_id, session_number, is_current, source,
    status,
    purchase_or_lease, vehicle_status,
    had_repairs, paid_for_repairs, repair_count, repair_attempts,
    last_repair_attempt_date, in_shop_30_days,
    contacted_manufacturer, manufacturer_offer,
    has_repair_documents, refund_preference,
    started_at, submitted_at,
    created_at, updated_at
  )
  SELECT
    case_id,
    1,                   -- session_number
    TRUE,                -- is_current
    'backfill',          -- source
    -- Status: submitted if any batches done, in_progress otherwise
    CASE WHEN completed_batch_count > 0 THEN 'submitted' ELSE 'in_progress' END,
    purchase_or_lease,
    vehicle_status,
    had_repairs, paid_for_repairs, repair_count, repair_attempts,
    last_repair_attempt_date, in_shop_30_days,
    contacted_manufacturer, manufacturer_offer,
    has_repair_documents, refund_preference,
    created_at,          -- started_at
    CASE WHEN completed_batch_count > 0 THEN updated_at ELSE NULL END, -- submitted_at
    created_at,
    updated_at
  FROM status_to_batches
  ON CONFLICT (case_id, session_number) DO NOTHING
  RETURNING id, case_id
)

-- Step 5b: Insert completed intake_batches
INSERT INTO core.intake_batches (session_id, batch_number, status, completed_at, created_at)
SELECT
  ins.id                       AS session_id,
  b.batch_number               AS batch_number,
  'completed'                  AS status,
  ins_sess.updated_at          AS completed_at,
  NOW()                        AS created_at
FROM inserted_sessions ins
JOIN core.intake_sessions ins_sess ON ins_sess.id = ins.id
JOIN status_to_batches stb ON stb.case_id = ins.case_id
-- Generate one row per completed batch using generate_series
JOIN LATERAL generate_series(1, GREATEST(stb.completed_batch_count, 0)) AS b(batch_number) ON TRUE
WHERE stb.completed_batch_count > 0
ON CONFLICT (session_id, batch_number) DO NOTHING;


-- Step 5c: Insert intake_problems from problem_1–4 columns
INSERT INTO core.intake_problems (session_id, problem_number, category, description, repair_attempts)
SELECT
  s.id                         AS session_id,
  p.problem_number,
  p.category,
  p.description,
  CASE WHEN p.repair_attempts_text ~ '^\d+$'
    THEN p.repair_attempts_text::INT ELSE NULL END AS repair_attempts
FROM core.intake_sessions s
JOIN core.case_intake ci ON ci.case_id = s.case_id
JOIN LATERAL (
  VALUES
    (1, ci.problem_1_category, ci.problem_1_notes, ci.problem_1_repair_attempts),
    (2, ci.problem_2_category, ci.problem_2_notes, ci.problem_2_repair_attempts),
    (3, ci.problem_3_category, ci.problem_3_notes, ci.problem_3_repair_attempts),
    (4, ci.problem_4_category, ci.problem_4_notes, ci.problem_4_repair_attempts)
) AS p(problem_number, category, description, repair_attempts_text)
  ON (p.category IS NOT NULL OR p.description IS NOT NULL)
WHERE s.source = 'backfill'
ON CONFLICT (session_id, problem_number) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════
-- 6. DEPRECATE core.case_intake (do not drop yet)
-- ═══════════════════════════════════════════════════════════════
-- Add a pointer to the new session for audit trail.
-- Table will be dropped in a future migration after validation.

ALTER TABLE core.case_intake
  ADD COLUMN IF NOT EXISTS migrated_to_session_id UUID
    REFERENCES core.intake_sessions(id);

-- Wire up the pointer
UPDATE core.case_intake ci
SET migrated_to_session_id = s.id
FROM core.intake_sessions s
WHERE s.case_id = ci.case_id
  AND s.is_current = TRUE
  AND ci.migrated_to_session_id IS NULL;


-- ═══════════════════════════════════════════════════════════════
-- 7. VERIFICATION
-- ═══════════════════════════════════════════════════════════════

-- (a) Sessions created vs source rows
SELECT
  (SELECT COUNT(1) FROM core.case_intake)           AS source_intake_rows,
  (SELECT COUNT(1) FROM core.intake_sessions
   WHERE source = 'backfill')                        AS sessions_created,
  (SELECT COUNT(1) FROM core.intake_sessions
   WHERE migrated_to_session_id IS NOT NULL
      OR id IN (SELECT migrated_to_session_id
                FROM core.case_intake
                WHERE migrated_to_session_id IS NOT NULL)) AS sessions_linked;

-- (b) Batch distribution
SELECT batch_number, status, COUNT(1) AS session_count
FROM core.intake_batches
GROUP BY batch_number, status
ORDER BY batch_number, status;

-- (c) Problems migrated
SELECT problem_number, COUNT(1) AS count
FROM core.intake_problems
GROUP BY problem_number
ORDER BY problem_number;

-- (d) case_state intake_status still consistent
SELECT intake_status, COUNT(1) AS cases
FROM core.case_state
GROUP BY intake_status
ORDER BY cases DESC;

NOTIFY pgrst, 'reload schema';
