-- migrate-team-v3-nullable-client-name.sql
-- Makes client_first_name and client_last_name nullable in core.cases.
-- These fields come from HubSpot contacts; some deals have no associated contact
-- or the contact has no name populated, causing upsert failures during sync.
-- Making them nullable allows all 46k+ deals to sync cleanly.

ALTER TABLE core.cases
  ALTER COLUMN client_first_name DROP NOT NULL,
  ALTER COLUMN client_last_name  DROP NOT NULL;

-- Verify
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'core'
  AND table_name   = 'cases'
  AND column_name  IN ('client_first_name', 'client_last_name')
ORDER BY column_name;
