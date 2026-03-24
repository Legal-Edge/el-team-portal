-- Migration: core.hubspot_engagements
-- Stores all HubSpot engagement records (calls, emails, SMS notes, notes)
-- pulled from both deal and associated contact records.
--
-- Run once in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS core.hubspot_engagements (
  engagement_id   text         PRIMARY KEY,                        -- HubSpot engagement ID (dedup key)
  case_id         uuid         NOT NULL REFERENCES core.cases(id) ON DELETE CASCADE,
  deal_id         text         NOT NULL,                           -- HubSpot deal ID
  contact_id      text,                                            -- HubSpot contact ID this was logged on (null = deal-level)
  contact_name    text,                                            -- Denormalized display name
  contact_initials text,                                           -- "CC" for Chris Cobble
  contact_color   text,                                            -- Hex color assigned per contact for this case
  contact_role    text,                                            -- "Primary", "Co-buyer", "Spouse", etc.
  engagement_type text         NOT NULL,                           -- CALL | NOTE | EMAIL | SMS
  direction       text,                                            -- inbound | outbound
  occurred_at     timestamptz  NOT NULL,
  body            text,                                            -- Note/email body (stripped HTML)
  call_summary    text,                                            -- Aloware AI call summary
  duration_ms     integer,                                         -- Call duration
  author_email    text,                                            -- HubSpot owner email
  metadata        jsonb        DEFAULT '{}',                       -- Full HubSpot metadata snapshot
  synced_at       timestamptz  DEFAULT now(),
  created_at      timestamptz  DEFAULT now()
);

-- Fast lookup by case + recency (primary query pattern)
CREATE INDEX IF NOT EXISTS idx_hs_eng_case_occurred
  ON core.hubspot_engagements(case_id, occurred_at DESC);

-- Lookup by deal_id (for webhook upserts without case UUID)
CREATE INDEX IF NOT EXISTS idx_hs_eng_deal_id
  ON core.hubspot_engagements(deal_id);

-- Lookup by contact_id (for webhook resolution)
CREATE INDEX IF NOT EXISTS idx_hs_eng_contact_id
  ON core.hubspot_engagements(contact_id)
  WHERE contact_id IS NOT NULL;

-- Realtime: enable for live timeline updates
ALTER TABLE core.hubspot_engagements REPLICA IDENTITY FULL;

COMMENT ON TABLE core.hubspot_engagements IS
  'HubSpot engagements synced from deal + all associated contact records. '
  'Deduplicated by engagement_id. contact_id/contact_name identify which contact the activity belongs to.';
