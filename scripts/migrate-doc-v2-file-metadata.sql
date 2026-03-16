-- doc-v2: Add creator/modifier name columns to document_files
-- SharePoint Graph API provides display names for who uploaded/modified each file

ALTER TABLE core.document_files
  ADD COLUMN IF NOT EXISTS created_by_name  TEXT,
  ADD COLUMN IF NOT EXISTS modified_by_name TEXT;
