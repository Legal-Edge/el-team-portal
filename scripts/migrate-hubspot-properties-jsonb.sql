-- Migration: Add hubspot_properties JSONB column to core.cases
-- Stores the full raw HubSpot deal properties object, updated on every webhook event.
-- This allows any HubSpot field to be accessed without schema migrations.

ALTER TABLE core.cases
  ADD COLUMN IF NOT EXISTS hubspot_properties JSONB,
  ADD COLUMN IF NOT EXISTS hubspot_contact_properties JSONB,
  ADD COLUMN IF NOT EXISTS hubspot_synced_at TIMESTAMPTZ;

-- Index for JSONB property lookups
CREATE INDEX IF NOT EXISTS idx_cases_hubspot_properties
  ON core.cases USING gin(hubspot_properties);

-- Helper: timestamp of last full sync
COMMENT ON COLUMN core.cases.hubspot_properties IS
  'Full HubSpot deal properties object, synced on every webhook event';

COMMENT ON COLUMN core.cases.hubspot_contact_properties IS
  'Full HubSpot contact properties object for the associated contact';
