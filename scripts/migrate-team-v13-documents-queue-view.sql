-- ============================================================
-- Migration: team-v13 — core.documents_queue view
-- ============================================================
-- Flattened view for the /documents cross-case queue.
-- Joins document_files + cases + case_document_checklist
-- + contacts (via case_contacts) + staff_users (reviewer + classifier).
-- review_sort enables priority ordering via PostgREST.
-- ============================================================

CREATE OR REPLACE VIEW core.documents_queue AS
SELECT
  df.id                                           AS doc_id,
  df.case_id,
  ca.case_number,
  ca.case_status,
  ca.hubspot_deal_id,
  ca.assigned_attorney,
  su_atty.display_name                            AS attorney_name,

  -- Client identity
  TRIM(CONCAT(
    COALESCE(co.first_name, ca.client_first_name, ''), ' ',
    COALESCE(co.last_name,  ca.client_last_name,  '')
  ))                                              AS client_full_name,
  COALESCE(co.phone, ca.client_phone)             AS client_phone,

  -- File details
  df.file_name,
  df.file_extension,
  df.source,
  df.web_url,
  df.size_bytes,
  df.document_type_code,
  df.created_at_source,
  df.synced_at,
  df.created_at,

  -- Classification
  df.is_classified,
  df.classification_source,
  df.classified_at,
  su_class.display_name                           AS classified_by_name,

  -- Review
  df.is_reviewed,
  df.review_notes,
  df.reviewed_at,
  su_rev.display_name                             AS reviewed_by_name,

  -- Checklist item status (what was expected for this doc)
  cl.status                                       AS checklist_status,

  -- Sort helper: unreviewed first, then unclassified, then reviewed
  CASE
    WHEN df.is_reviewed = FALSE AND df.is_classified = FALSE THEN 1  -- needs both
    WHEN df.is_reviewed = FALSE AND df.is_classified = TRUE  THEN 2  -- classified, needs review
    WHEN df.is_reviewed = TRUE                               THEN 3  -- done
    ELSE                                                          4
  END                                             AS review_sort

FROM core.document_files df
JOIN core.cases ca
  ON ca.id = df.case_id AND ca.is_deleted = FALSE
LEFT JOIN core.case_contacts cc
  ON cc.case_id = ca.id AND cc.is_primary = TRUE AND cc.is_deleted = FALSE
LEFT JOIN core.contacts co
  ON co.id = cc.contact_id
LEFT JOIN staff.staff_users su_atty
  ON su_atty.id = ca.assigned_attorney
LEFT JOIN staff.staff_users su_rev
  ON su_rev.id = df.reviewed_by
LEFT JOIN staff.staff_users su_class
  ON su_class.id = df.classified_by
LEFT JOIN core.case_document_checklist cl
  ON cl.id = df.checklist_item_id
WHERE df.is_deleted = FALSE;

GRANT SELECT ON core.documents_queue TO service_role, authenticated;

-- Index to support queue sort + filter patterns
CREATE INDEX IF NOT EXISTS idx_document_files_queue
  ON core.document_files (is_reviewed, is_classified, created_at DESC)
  WHERE is_deleted = FALSE;

NOTIFY pgrst, 'reload schema';
