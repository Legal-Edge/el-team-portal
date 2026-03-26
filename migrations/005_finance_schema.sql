-- ============================================================
-- Migration 005: Finance schema for QuickBooks integration
-- Two QB companies: Legal Edge, LLC + RockPoint Law, P.C.
-- ============================================================

-- Enable finance schema
CREATE SCHEMA IF NOT EXISTS finance;

-- ── QB company connections ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance.qb_entities (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_name       text        NOT NULL,         -- 'Legal Edge, LLC' or 'RockPoint Law, P.C.'
  entity_slug       text        UNIQUE NOT NULL,  -- 'legal-edge' or 'rockpoint'
  realm_id          text        UNIQUE,           -- QuickBooks company realmId (set on OAuth)
  access_token      text,                         -- QB access token
  refresh_token     text,                         -- QB refresh token
  token_expires_at  timestamptz,
  connected         boolean     DEFAULT false,
  connected_at      timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- Seed the two entities
INSERT INTO finance.qb_entities (entity_name, entity_slug)
VALUES
  ('Legal Edge, LLC',     'legal-edge'),
  ('RockPoint Law, P.C.', 'rockpoint')
ON CONFLICT (entity_slug) DO NOTHING;

-- ── Chart of accounts ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance.qb_accounts (
  id                    uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id             uuid  NOT NULL REFERENCES finance.qb_entities(id) ON DELETE CASCADE,
  qb_account_id         text  NOT NULL,
  name                  text  NOT NULL,
  account_type          text,   -- 'Expense', 'Income', 'Asset', 'Liability', etc.
  account_sub_type      text,
  classification        text,   -- 'Expense', 'Revenue', 'Asset', 'Liability'
  parent_ref_value      text,   -- parent account QB id
  fully_qualified_name  text,   -- e.g. 'Advertising & Marketing:PPC - Google'
  active                boolean DEFAULT true,
  synced_at             timestamptz DEFAULT now(),
  UNIQUE (entity_id, qb_account_id)
);

-- ── Transactions (header) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance.qb_transactions (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id           uuid          NOT NULL REFERENCES finance.qb_entities(id) ON DELETE CASCADE,
  qb_transaction_id   text          NOT NULL,
  transaction_type    text          NOT NULL,  -- 'Purchase', 'Bill', 'JournalEntry', 'Invoice'
  transaction_date    date          NOT NULL,
  doc_number          text,
  vendor_name         text,
  customer_name       text,
  memo                text,
  total_amount        numeric(12,2),
  currency_code       text          DEFAULT 'USD',
  synced_at           timestamptz   DEFAULT now(),
  raw_json            jsonb,
  UNIQUE (entity_id, qb_transaction_id, transaction_type)
);

-- ── Transaction line items ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance.qb_transaction_lines (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id        uuid          NOT NULL REFERENCES finance.qb_transactions(id) ON DELETE CASCADE,
  entity_id             uuid          NOT NULL REFERENCES finance.qb_entities(id) ON DELETE CASCADE,
  line_num              int,
  qb_account_id         text,
  account_name          text,
  account_type          text,
  fully_qualified_name  text,    -- full path: 'Advertising & Marketing:PPC - Google'
  expense_group         text,    -- top-level parent: 'Advertising & Marketing'
  description           text,
  amount                numeric(12,2),
  transaction_date      date,    -- denormalized for fast queries
  entity_name           text,    -- denormalized: 'Legal Edge, LLC'
  created_at            timestamptz DEFAULT now()
);

-- ── Sync state ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance.qb_sync_state (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id          uuid          UNIQUE NOT NULL REFERENCES finance.qb_entities(id) ON DELETE CASCADE,
  sync_type          text          DEFAULT 'full',  -- 'full' or 'delta'
  last_synced_at     timestamptz,
  last_change_token  text,         -- QB CDC token for delta syncs
  status             text          DEFAULT 'idle',  -- 'idle', 'running', 'completed', 'error'
  error_message      text,
  records_synced     int           DEFAULT 0,
  started_at         timestamptz,
  completed_at       timestamptz
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_qb_lines_entity_date   ON finance.qb_transaction_lines (entity_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_qb_lines_account_type  ON finance.qb_transaction_lines (entity_id, account_type);
CREATE INDEX IF NOT EXISTS idx_qb_lines_expense_group ON finance.qb_transaction_lines (expense_group);
CREATE INDEX IF NOT EXISTS idx_qb_txn_entity_date     ON finance.qb_transactions      (entity_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_qb_txn_type            ON finance.qb_transactions      (entity_id, transaction_type);

-- ── Grants ──────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA finance TO service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA finance TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA finance TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA finance GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA finance GRANT ALL ON SEQUENCES TO service_role;
