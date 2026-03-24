-- Migration: add extracted_text column to core.document_files
-- Run once in Supabase SQL Editor.

ALTER TABLE core.document_files
  ADD COLUMN IF NOT EXISTS extracted_text TEXT;

-- Optional: index for full-text search (run separately if needed)
-- CREATE INDEX IF NOT EXISTS idx_doc_files_fts
--   ON core.document_files USING gin(to_tsvector('english', coalesce(extracted_text, '')));

COMMENT ON COLUMN core.document_files.extracted_text
  IS 'Raw text extracted from the file (PDF text layer, DOCX, or plain text). NULL if unsupported format, scanned PDF, or not yet extracted.';
