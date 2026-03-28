-- ─────────────────────────────────────────────────────────────────────────────
-- migrate-team-v16-resilience.sql
--
-- Webhook resilience infrastructure:
--   1. advance_case_number_seq() RPC  — auto-fix sequence exhaustion
--   2. failed_webhook_events table    — persistent failed event log for replay
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. RPC: advance case_number_seq past current max ─────────────────────────
-- Called by upsertCase() when it detects a case_number constraint violation.
-- Safe to call multiple times — idempotent.
CREATE OR REPLACE FUNCTION core.advance_case_number_seq()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_val BIGINT;
BEGIN
  SELECT setval(
    'core.case_number_seq',
    COALESCE(
      (SELECT MAX(CAST(SPLIT_PART(case_number, '-', 3) AS BIGINT))
       FROM core.cases
       WHERE case_number ~ '^EL-\d{4}-\d+$'),
      0
    ) + 100   -- +100 buffer to handle concurrent inserts
  ) INTO new_val;
  RETURN new_val;
END;
$$;

-- Grant to service role (used by API routes via service role key)
GRANT EXECUTE ON FUNCTION core.advance_case_number_seq() TO service_role;

-- ── 2. failed_webhook_events — persistent store for events that errored ───────
CREATE TABLE IF NOT EXISTS core.failed_webhook_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL    DEFAULT now(),
  deal_id       TEXT        NOT NULL,
  event_type    TEXT        NOT NULL,   -- 'deal.creation' | 'deal.propertyChange' | etc.
  error_message TEXT,
  payload       JSONB,
  replayed_at   TIMESTAMPTZ,            -- set when replay succeeds
  replay_result TEXT                    -- 'created' | 'upserted' | 'error: ...'
);

CREATE INDEX IF NOT EXISTS failed_webhook_events_deal_id_idx ON core.failed_webhook_events (deal_id);
CREATE INDEX IF NOT EXISTS failed_webhook_events_created_at_idx ON core.failed_webhook_events (created_at);
CREATE INDEX IF NOT EXISTS failed_webhook_events_replayed_idx ON core.failed_webhook_events (replayed_at) WHERE replayed_at IS NULL;

-- Enable RLS but allow service role full access
ALTER TABLE core.failed_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON core.failed_webhook_events TO service_role USING (true) WITH CHECK (true);
