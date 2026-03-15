-- Migration team-v2: Add is_internal flag to core.communications
-- Controls role-based visibility in the communications timeline.
-- Staff role cannot see is_internal = true items (filtered server-side).
-- Admin, attorney, manager see all items regardless of flag.
--
-- Run in Supabase SQL Editor.

ALTER TABLE core.communications
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

-- Index for fast filtering in the comms API
CREATE INDEX IF NOT EXISTS idx_comms_is_internal
  ON core.communications(case_id, is_internal, occurred_at DESC);

COMMENT ON COLUMN core.communications.is_internal IS
  'When true, item is restricted to admin/attorney/manager roles only. Staff role cannot see these rows.';
