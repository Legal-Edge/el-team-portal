-- ─────────────────────────────────────────────────────────────────────────────
-- doc-v1: Document Collection State
--
-- Adds:
--   1. sharepoint_drive_item_id on core.cases (resolved from sharepoint_file_url)
--   2. core.document_collection_state — mirrors 4 HubSpot doc fields per case
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. SharePoint folder reference on cases
ALTER TABLE core.cases
  ADD COLUMN IF NOT EXISTS sharepoint_file_url       TEXT,
  ADD COLUMN IF NOT EXISTS sharepoint_drive_item_id  TEXT,
  ADD COLUMN IF NOT EXISTS sharepoint_synced_at      TIMESTAMPTZ;

-- 2. Document collection state (mirrors HubSpot fields)
CREATE TABLE IF NOT EXISTS core.document_collection_state (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                     UUID NOT NULL REFERENCES core.cases(id) ON DELETE CASCADE,

  -- HubSpot: documents_needed (checkbox — multi-select)
  documents_needed            TEXT[]    NOT NULL DEFAULT '{}',

  -- HubSpot: document_collection_status (select)
  collection_status           TEXT,

  -- HubSpot: document_collection_notes (textarea)
  collection_notes            TEXT,

  -- HubSpot: document_promise_date (date)
  promise_date                DATE,

  -- Sync metadata
  synced_from_hubspot_at      TIMESTAMPTZ,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                  TEXT,

  CONSTRAINT uq_doc_collection_state_case UNIQUE (case_id)
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_doc_collection_state_case
  ON core.document_collection_state (case_id);

CREATE INDEX IF NOT EXISTS idx_doc_collection_status
  ON core.document_collection_state (collection_status)
  WHERE collection_status IS NOT NULL;

-- Realtime
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'core'
      AND tablename = 'document_collection_state'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE core.document_collection_state;
  END IF;
END $$;

-- updated_at trigger
CREATE OR REPLACE FUNCTION core.touch_document_collection_state()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_doc_collection_state ON core.document_collection_state;
CREATE TRIGGER trg_touch_doc_collection_state
  BEFORE UPDATE ON core.document_collection_state
  FOR EACH ROW EXECUTE FUNCTION core.touch_document_collection_state();
