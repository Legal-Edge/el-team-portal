-- ============================================================
-- MIGRATION v6: Source-Agnostic Communications Schema
-- Makes core.communications support multiple source systems
-- (HubSpot, Aloware, etc.) without HubSpot-specific constraints
-- Run in Supabase SQL Editor
-- ============================================================

-- Step 1: Make hubspot_engagement_id nullable
-- HubSpot rows keep their IDs; non-HubSpot rows will be NULL
ALTER TABLE core.communications
  ALTER COLUMN hubspot_engagement_id DROP NOT NULL;

-- Step 2: Add source_record_id for source-agnostic deduplication
ALTER TABLE core.communications
  ADD COLUMN IF NOT EXISTS source_record_id TEXT;

-- Step 3: Backfill source_record_id for existing HubSpot rows
-- so they satisfy the new unique constraint
UPDATE core.communications
  SET source_record_id = hubspot_engagement_id
  WHERE source_system = 'hubspot'
  AND source_record_id IS NULL;

-- Step 4: Drop the old HubSpot-specific unique constraint
ALTER TABLE core.communications
  DROP CONSTRAINT IF EXISTS communications_hubspot_engagement_id_source_system_key;

-- Step 5: Add the correct source-agnostic unique constraint
-- NULL source_record_id values are excluded (unresolved rows won't conflict)
ALTER TABLE core.communications
  ADD CONSTRAINT uq_communications_source
  UNIQUE (source_system, source_record_id);

-- Step 6: Add index for fast lookups by source
CREATE INDEX IF NOT EXISTS idx_comms_source_record_id
  ON core.communications(source_system, source_record_id);

-- Verify migration
SELECT
  COUNT(*) AS total_rows,
  COUNT(hubspot_engagement_id) AS rows_with_hubspot_id,
  COUNT(source_record_id) AS rows_with_source_record_id
FROM core.communications;
