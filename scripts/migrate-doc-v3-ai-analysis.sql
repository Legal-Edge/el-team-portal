-- doc-v3: AI document analysis fields on document_files
ALTER TABLE core.document_files
  ADD COLUMN IF NOT EXISTS ai_summary      JSONB,
  ADD COLUMN IF NOT EXISTS ai_analyzed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_model        TEXT;

COMMENT ON COLUMN core.document_files.ai_summary IS
  'Structured lemon law analysis from Claude. Shape varies by document_type_code.';
