-- ============================================================
-- Migration: team-v15 — core.case_doc_summary view + doc Realtime
-- ============================================================
-- Adds a per-case document health summary view used by:
--   • GET /api/cases      → doc_state enrichment per case row
--   • GET /api/doc-stats  → dashboard aggregate KPIs
-- Also enables Realtime on core.document_files so dashboard
-- KPI cards update live when documents are classified/reviewed.
-- ============================================================

-- ── 1. case_doc_summary view ──────────────────────────────────

CREATE OR REPLACE VIEW core.case_doc_summary AS
WITH doc_counts AS (
  SELECT
    case_id,
    COUNT(id)                                                          AS total_docs,
    COUNT(id) FILTER (WHERE NOT is_classified)                         AS unclassified,
    COUNT(id) FILTER (WHERE is_classified AND NOT is_reviewed)         AS needs_review,
    MAX(created_at) FILTER (WHERE created_at >= NOW() - INTERVAL '24h') AS recent_upload_at
  FROM core.document_files
  WHERE is_deleted = FALSE
  GROUP BY case_id
),
checklist_counts AS (
  SELECT
    case_id,
    COUNT(id) FILTER (
      WHERE status IN ('required', 'requested')
        AND is_required = TRUE
    )                                                                  AS missing_required
  FROM core.case_document_checklist
  WHERE is_deleted = FALSE
  GROUP BY case_id
)
SELECT
  d.case_id,
  d.total_docs,
  d.unclassified,
  d.needs_review,
  COALESCE(c.missing_required, 0)  AS missing_required,
  d.recent_upload_at               AS recent_upload_at
FROM doc_counts d
LEFT JOIN checklist_counts c ON c.case_id = d.case_id;

GRANT SELECT ON core.case_doc_summary TO service_role, authenticated;

-- ── 2. REPLICA IDENTITY FULL for Realtime row delivery ────────

ALTER TABLE core.document_files           REPLICA IDENTITY FULL;
ALTER TABLE core.case_document_checklist  REPLICA IDENTITY FULL;

-- ── 3. Idempotent publication guard ───────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'core' AND tablename = 'document_files'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE core.document_files;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'core' AND tablename = 'case_document_checklist'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE core.case_document_checklist;
  END IF;
END $$;

-- ── 4. Verify ─────────────────────────────────────────────────

SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'core'
ORDER BY tablename;

NOTIFY pgrst, 'reload schema';
