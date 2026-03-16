-- doc-v4: Two-stage AI pipeline columns
-- Haiku per-document extraction + Sonnet case-level analysis
-- Safe to run even if doc-v3 was already run (IF NOT EXISTS guards)

-- Per-document extraction (Haiku)
ALTER TABLE core.document_files
  ADD COLUMN IF NOT EXISTS ai_extraction        JSONB,
  ADD COLUMN IF NOT EXISTS ai_extracted_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_extraction_model  TEXT;

-- Keep doc-v3 columns too (IF NOT EXISTS = no-op if already run)
ALTER TABLE core.document_files
  ADD COLUMN IF NOT EXISTS ai_summary      JSONB,
  ADD COLUMN IF NOT EXISTS ai_analyzed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_model        TEXT;

-- Case-level analysis (Sonnet) stored on core.cases
ALTER TABLE core.cases
  ADD COLUMN IF NOT EXISTS ai_analysis      JSONB,
  ADD COLUMN IF NOT EXISTS ai_analyzed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_analyzed_model TEXT;
