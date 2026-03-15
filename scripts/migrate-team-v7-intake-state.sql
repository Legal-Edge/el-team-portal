-- ============================================================
-- Migration: team-v7 — Intake State Ownership
-- ============================================================
-- Adds el_app_status to core.cases so it syncs from HubSpot.
-- Backfills core.case_state rows for all existing cases.
-- After this runs, lib/pipelines/hubspot.ts will populate
-- intake_status on every case sync going forward.
-- ============================================================

-- Add el_app_status column to core.cases
ALTER TABLE core.cases
  ADD COLUMN IF NOT EXISTS el_app_status TEXT;

-- Index for common intake queries
CREATE INDEX IF NOT EXISTS idx_cases_el_app_status
  ON core.cases (el_app_status)
  WHERE el_app_status IS NOT NULL;

-- Backfill core.case_state for every existing case.
-- intake_status starts as 'not_started' — will be updated by
-- the next HubSpot delta sync once el_app_status is populated.
INSERT INTO core.case_state (case_id, intake_status, updated_at)
SELECT
  id,
  'not_started',
  NOW()
FROM core.cases
WHERE is_deleted = FALSE
ON CONFLICT (case_id) DO NOTHING;

COMMENT ON COLUMN core.cases.el_app_status IS
  'HubSpot el_app_status property — synced from HubSpot; authoritative copy lives in core.case_state.intake_status';
