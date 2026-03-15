-- Migration: team-v5
-- Adds notes_last_updated to core.cases for last-activity sorting

ALTER TABLE core.cases
  ADD COLUMN IF NOT EXISTS notes_last_updated TIMESTAMPTZ;

-- Index for fast sort
CREATE INDEX IF NOT EXISTS idx_cases_notes_last_updated
  ON core.cases (notes_last_updated DESC NULLS LAST);

COMMENT ON COLUMN core.cases.notes_last_updated IS
  'HubSpot notes_last_updated — timestamp of most recent note/activity on the deal';
