-- ============================================================
-- Migration: security-invoker-views
-- Fix: Supabase security linter lint 0010_security_definer_view
--
-- All three flagged views (documents_queue, case_doc_summary,
-- comms_inbox) are recreated with WITH (security_invoker = true).
-- This ensures RLS on underlying tables is enforced using the
-- querying user's permissions, not the view creator's.
--
-- Cross-schema JOIN on staff.staff_users (display_name) requires
-- a minimal SELECT grant on that table for the authenticated role.
-- ============================================================

-- ── 0. Grant authenticated role minimum access to staff tables ─────────────
-- Required for SECURITY INVOKER views that LEFT JOIN staff.staff_users.
-- Only exposing id + display_name — no sensitive columns.
GRANT USAGE ON SCHEMA staff TO authenticated;
GRANT SELECT (id, display_name, email) ON staff.staff_users TO authenticated;

-- ── 1. core.documents_queue ────────────────────────────────────────────────
CREATE OR REPLACE VIEW core.documents_queue
WITH (security_invoker = true)
AS
SELECT
  df.id                                           AS doc_id,
  df.case_id,
  ca.case_number,
  ca.case_status,
  ca.hubspot_deal_id,
  ca.assigned_attorney,
  su_atty.display_name                            AS attorney_name,

  TRIM(CONCAT(
    COALESCE(co.first_name, ca.client_first_name, ''), ' ',
    COALESCE(co.last_name,  ca.client_last_name,  '')
  ))                                              AS client_full_name,
  COALESCE(co.phone, ca.client_phone)             AS client_phone,

  -- Immutable file identity
  df.file_name,
  df.file_extension,
  df.source,
  df.web_url,
  df.size_bytes,
  df.created_at_source,
  df.synced_at,
  df.created_at,

  -- Classification + review state (from document_review_state)
  COALESCE(drs.is_classified, FALSE)              AS is_classified,
  drs.document_type_code,
  drs.classification_source,
  drs.classified_at,
  su_class.display_name                           AS classified_by_name,
  COALESCE(drs.is_reviewed, FALSE)                AS is_reviewed,
  drs.review_notes,
  drs.reviewed_at,
  su_rev.display_name                             AS reviewed_by_name,

  -- Checklist expected status
  cl.status                                       AS checklist_status,

  -- Sort: 1=unclassified, 2=classified+needs review, 3=reviewed
  CASE
    WHEN COALESCE(drs.is_reviewed, FALSE) = FALSE
     AND COALESCE(drs.is_classified, FALSE) = FALSE THEN 1
    WHEN COALESCE(drs.is_reviewed, FALSE) = FALSE
     AND COALESCE(drs.is_classified, FALSE) = TRUE  THEN 2
    WHEN COALESCE(drs.is_reviewed, FALSE) = TRUE    THEN 3
    ELSE 4
  END                                             AS review_sort

FROM core.document_files df
JOIN core.cases ca
  ON ca.id = df.case_id AND ca.is_deleted = FALSE
LEFT JOIN core.document_review_state drs
  ON drs.doc_id = df.id
LEFT JOIN core.case_contacts cc
  ON cc.case_id = ca.id AND cc.is_primary = TRUE AND cc.is_deleted = FALSE
LEFT JOIN core.contacts co
  ON co.id = cc.contact_id
LEFT JOIN staff.staff_users su_atty
  ON su_atty.id = ca.assigned_attorney
LEFT JOIN staff.staff_users su_rev
  ON su_rev.id = drs.reviewed_by
LEFT JOIN staff.staff_users su_class
  ON su_class.id = drs.classified_by
LEFT JOIN core.case_document_checklist cl
  ON cl.id = df.checklist_item_id
WHERE df.is_deleted = FALSE;

GRANT SELECT ON core.documents_queue TO service_role, authenticated;

-- ── 2. core.case_doc_summary ───────────────────────────────────────────────
CREATE OR REPLACE VIEW core.case_doc_summary
WITH (security_invoker = true)
AS
WITH doc_counts AS (
  SELECT
    df.case_id,
    COUNT(df.id)                                                               AS total_docs,
    COUNT(df.id) FILTER (WHERE COALESCE(drs.is_classified, FALSE) = FALSE)     AS unclassified,
    COUNT(df.id) FILTER (WHERE COALESCE(drs.is_classified, FALSE) = TRUE
                           AND COALESCE(drs.is_reviewed,   FALSE) = FALSE)     AS needs_review,
    MAX(df.created_at) FILTER (
      WHERE df.created_at >= NOW() - INTERVAL '24h'
    )                                                                           AS recent_upload_at
  FROM core.document_files df
  LEFT JOIN core.document_review_state drs ON drs.doc_id = df.id
  WHERE df.is_deleted = FALSE
  GROUP BY df.case_id
),
checklist_counts AS (
  SELECT
    case_id,
    COUNT(id) FILTER (
      WHERE status IN ('required', 'requested') AND is_required = TRUE
    )                                                                           AS missing_required
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
  d.recent_upload_at
FROM doc_counts d
LEFT JOIN checklist_counts c ON c.case_id = d.case_id;

GRANT SELECT ON core.case_doc_summary TO service_role, authenticated;

-- ── 3. core.comms_inbox ────────────────────────────────────────────────────
CREATE OR REPLACE VIEW core.comms_inbox
WITH (security_invoker = true)
AS
SELECT
  cs.case_id,
  ca.case_number,
  ca.case_status,
  ca.hubspot_deal_id,

  COALESCE(co.first_name, ca.client_first_name)  AS client_first_name,
  COALESCE(co.last_name,  ca.client_last_name)   AS client_last_name,
  TRIM(CONCAT(
    COALESCE(co.first_name, ca.client_first_name, ''), ' ',
    COALESCE(co.last_name,  ca.client_last_name,  '')
  ))                                              AS client_full_name,
  COALESCE(co.phone, ca.client_phone)             AS client_phone,
  co.email                                        AS client_email,

  ca.assigned_attorney,
  su.display_name                                 AS attorney_name,

  cs.last_inbound_at,
  cs.last_outbound_at,
  cs.last_inbound_channel,
  cs.awaiting_response,
  cs.response_due_at,
  cs.sla_status,
  cs.unread_count,
  cs.updated_at,

  CASE cs.sla_status
    WHEN 'overdue'  THEN 1
    WHEN 'due_soon' THEN 2
    WHEN 'ok'       THEN 3
    ELSE                 4
  END AS sla_sort

FROM core.comms_state cs
JOIN core.cases ca
  ON ca.id = cs.case_id AND ca.is_deleted = FALSE
LEFT JOIN core.case_contacts cc
  ON cc.case_id = ca.id AND cc.is_primary = TRUE AND cc.is_deleted = FALSE
LEFT JOIN core.contacts co
  ON co.id = cc.contact_id
LEFT JOIN staff.staff_users su
  ON su.id = ca.assigned_attorney
WHERE cs.last_inbound_at IS NOT NULL;

GRANT SELECT ON core.comms_inbox TO service_role, authenticated;

-- ── Reload schema cache ────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
