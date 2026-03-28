-- ── Finance: HubSpot settlement revenue ─────────────────────────────────────
-- Each row = one settled HubSpot deal. Revenue attributed to RockPoint Law.
-- Revenue date = date_settled (preferred) or date_disburse (fallback).

CREATE TABLE IF NOT EXISTS finance.settlements (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_deal_id   text        NOT NULL,
  deal_name         text,
  attorneys_fees    numeric(12,2) NOT NULL DEFAULT 0,
  date_settled      date,         -- date___settled in HubSpot
  date_disburse     date,         -- date___disburse_funds in HubSpot
  revenue_date      date NOT NULL, -- COALESCE(date_settled, date_disburse)
  entity_name       text        NOT NULL DEFAULT 'RockPoint Law, P.C.',
  synced_at         timestamptz DEFAULT now(),
  CONSTRAINT settlements_deal_id_key UNIQUE (hubspot_deal_id)
);

-- Enable Realtime so Finance page updates live when new settlements land
ALTER TABLE finance.settlements REPLICA IDENTITY FULL;

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_settlements_revenue_date ON finance.settlements (revenue_date DESC);
CREATE INDEX IF NOT EXISTS idx_settlements_entity       ON finance.settlements (entity_name);

-- Service role access
GRANT ALL ON finance.settlements TO service_role;
