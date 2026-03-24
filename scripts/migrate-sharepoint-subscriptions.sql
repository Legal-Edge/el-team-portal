-- migrate-sharepoint-subscriptions.sql
-- Per-case Graph subscription tracking for SharePoint live sync
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS core.case_sp_subscriptions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         uuid        NOT NULL REFERENCES core.cases(id) ON DELETE CASCADE,
  subscription_id text        NOT NULL UNIQUE,
  drive_item_id   text        NOT NULL,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_sp_subs_subscription_id ON core.case_sp_subscriptions (subscription_id);
CREATE INDEX IF NOT EXISTS idx_case_sp_subs_expires_at      ON core.case_sp_subscriptions (expires_at);
CREATE INDEX IF NOT EXISTS idx_case_sp_subs_case_id         ON core.case_sp_subscriptions (case_id);

-- RLS: service role only (internal use)
ALTER TABLE core.case_sp_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role full access" ON core.case_sp_subscriptions
  USING (true) WITH CHECK (true);
