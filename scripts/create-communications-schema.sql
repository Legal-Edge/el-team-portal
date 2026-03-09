-- ============================================================
-- COMMUNICATIONS LAYER
-- Case-centric comms normalized from HubSpot contact activities
-- Run in Supabase SQL Editor
-- ============================================================

-- ─── case_contacts ───────────────────────────────────────────
-- Links HubSpot contacts to cases.
-- Supports multiple contacts per case (co-buyer, spouse, etc.)
CREATE TABLE IF NOT EXISTS core.case_contacts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id              UUID NOT NULL REFERENCES core.cases(id) ON DELETE CASCADE,
  hubspot_contact_id   TEXT NOT NULL,
  first_name           TEXT,
  last_name            TEXT,
  email                TEXT,
  phone                TEXT,
  relationship         TEXT NOT NULL DEFAULT 'primary'
                         CHECK (relationship IN ('primary','co_buyer','spouse','guarantor','other')),
  is_primary           BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (case_id, hubspot_contact_id)
);

CREATE INDEX IF NOT EXISTS idx_case_contacts_case_id
  ON core.case_contacts(case_id);
CREATE INDEX IF NOT EXISTS idx_case_contacts_hs_contact
  ON core.case_contacts(hubspot_contact_id);

-- ─── communications ──────────────────────────────────────────
-- Normalized communications tied to case_id.
-- Source of truth is HubSpot; this is the case-centric view.
CREATE TABLE IF NOT EXISTS core.communications (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id              UUID NOT NULL REFERENCES core.cases(id) ON DELETE CASCADE,
  case_contact_id      UUID REFERENCES core.case_contacts(id),
  hubspot_engagement_id TEXT NOT NULL,
  hubspot_contact_id   TEXT,
  hubspot_deal_id      TEXT,

  -- Channel + direction
  channel              TEXT NOT NULL
                         CHECK (channel IN ('call','sms','email','note','task','meeting','other')),
  direction            TEXT
                         CHECK (direction IN ('inbound','outbound','unknown')),

  -- Content (phase 1: snippet only; phase 2: full body)
  subject              TEXT,
  snippet              TEXT,    -- first 500 chars max
  body                 TEXT,    -- full body, populated in phase 2

  -- Timing + outcome
  occurred_at          TIMESTAMPTZ,
  duration_seconds     INTEGER,   -- calls only
  outcome              TEXT,      -- call disposition (CONNECTED, NO_ANSWER, etc.)

  -- Resolution tracking
  source_system        TEXT NOT NULL DEFAULT 'hubspot',
  resolution_method    TEXT
                         CHECK (resolution_method IN (
                           'deal_association',       -- engagement directly tied to deal
                           'contact_single_case',    -- contact had only 1 active case
                           'contact_date_proximity', -- resolved by closest case date
                           'manual'                  -- manually assigned
                         )),
  needs_review         BOOLEAN NOT NULL DEFAULT FALSE,
  review_reason        TEXT,

  -- Raw payload for auditability / phase 2 enrichment
  raw_metadata         JSONB NOT NULL DEFAULT '{}',

  is_deleted           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (hubspot_engagement_id, source_system)
);

CREATE INDEX IF NOT EXISTS idx_comms_case_id
  ON core.communications(case_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_comms_engagement_id
  ON core.communications(hubspot_engagement_id);
CREATE INDEX IF NOT EXISTS idx_comms_contact_id
  ON core.communications(hubspot_contact_id);
CREATE INDEX IF NOT EXISTS idx_comms_needs_review
  ON core.communications(needs_review) WHERE needs_review = TRUE;
CREATE INDEX IF NOT EXISTS idx_comms_channel
  ON core.communications(channel, occurred_at DESC);

-- ─── Grants ──────────────────────────────────────────────────
GRANT ALL ON core.case_contacts TO service_role;
GRANT ALL ON core.communications TO service_role;
GRANT SELECT ON core.case_contacts TO authenticated, anon;
GRANT SELECT ON core.communications TO authenticated, anon;
