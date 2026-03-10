-- ═══════════════════════════════════════════════════════════════════════════
-- EL Team Portal — New Document Types Migration
-- Safe to re-run (ON CONFLICT DO NOTHING)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO core.document_types
  (code, label, description, is_required_default, required_for_stages, sort_order)
VALUES
  (
    'maintenance_record',
    'Maintenance Record',
    'Routine maintenance records (oil changes, tire rotations, scheduled service)',
    FALSE,
    ARRAY[]::TEXT[],
    5
  ),
  (
    'recall_notice',
    'Recall Notice',
    'NHTSA or manufacturer recall notice applicable to the vehicle',
    FALSE,
    ARRAY[]::TEXT[],
    14
  ),
  (
    'vehicle_history_report',
    'Vehicle History Report',
    'Carfax, AutoCheck, or equivalent vehicle history report',
    FALSE,
    ARRAY[]::TEXT[],
    15
  )
ON CONFLICT (code) DO NOTHING;

-- Add checklist rows for these new types on all existing cases
-- (is_required=false — these are never stage-required by default)
INSERT INTO core.case_document_checklist
  (case_id, document_type_code, status, is_required, created_at, updated_at)
SELECT
  c.id,
  t.code,
  'required',
  FALSE,
  NOW(),
  NOW()
FROM core.cases c
CROSS JOIN (
  SELECT code FROM core.document_types
  WHERE code IN ('maintenance_record', 'recall_notice', 'vehicle_history_report')
) t
WHERE c.is_deleted = FALSE
ON CONFLICT (case_id, document_type_code) DO NOTHING;

NOTIFY pgrst, 'reload schema';
