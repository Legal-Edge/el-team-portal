-- ═══════════════════════════════════════════════════════════════════════════
-- EL Team Portal — Webhook Captures Table (for payload inspection)
-- Safe to re-run
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS infrastructure.webhook_captures (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source      TEXT        NOT NULL,           -- 'aloware', 'sharepoint', etc.
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type  TEXT,                           -- extracted from payload if present
  ip_address  TEXT,                           -- request originating IP
  headers     JSONB,                          -- sanitised request headers
  body        JSONB,                          -- parsed JSON body (if JSON)
  raw_body    TEXT,                           -- raw body string always stored
  notes       TEXT                            -- manual annotations
);

CREATE INDEX IF NOT EXISTS webhook_captures_source_idx
  ON infrastructure.webhook_captures (source, captured_at DESC);

-- Allow service role full access; anon/authenticated read for admin viewer
ALTER TABLE infrastructure.webhook_captures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON infrastructure.webhook_captures
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read" ON infrastructure.webhook_captures
  FOR SELECT TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';
