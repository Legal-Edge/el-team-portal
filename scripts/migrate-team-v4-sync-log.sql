-- migrate-team-v4-sync-log.sql
-- Adds sync cursor + audit log for webhook and Vercel cron delta sync
-- Run in Supabase SQL Editor

-- ── sync_state: single cursor row per key ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS core.sync_state (
  key        text        PRIMARY KEY,
  value      text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed cursor to 1 hour ago — first cron run will catch any recent gaps
INSERT INTO core.sync_state (key, value)
VALUES ('last_delta_sync_at', (NOW() - INTERVAL '1 hour')::text)
ON CONFLICT (key) DO NOTHING;

-- ── sync_log: audit trail for all sync operations ────────────────────────────
CREATE TABLE IF NOT EXISTS core.sync_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type      text        NOT NULL CHECK (sync_type IN ('webhook', 'cron_delta', 'manual')),
  triggered_at   timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  deals_seen     integer     NOT NULL DEFAULT 0,
  deals_synced   integer     NOT NULL DEFAULT 0,
  deals_errored  integer     NOT NULL DEFAULT 0,
  modified_since timestamptz,
  status         text        NOT NULL DEFAULT 'running'
                             CHECK (status IN ('running', 'success', 'partial', 'error')),
  notes          text,
  errors         jsonb       NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_sync_log_triggered_at ON core.sync_log (triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_log_sync_type    ON core.sync_log (sync_type);

-- Trim log to last 2,000 rows automatically (prevent unbounded growth)
CREATE OR REPLACE FUNCTION core.trim_sync_log() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM core.sync_log
  WHERE id IN (
    SELECT id FROM core.sync_log
    ORDER BY triggered_at DESC
    OFFSET 2000
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_trim_sync_log ON core.sync_log;
CREATE TRIGGER trg_trim_sync_log
  AFTER INSERT ON core.sync_log
  FOR EACH STATEMENT EXECUTE FUNCTION core.trim_sync_log();
