-- ============================================================
-- COMBINED SECURITY MIGRATION — Run once in Supabase SQL Editor
-- Covers: v17 missing tables + all security linter fixes
-- ============================================================

-- ── 1. Create missing tables (v17) ────────────────────────────

CREATE TABLE IF NOT EXISTS core.comms_review_state (
  comm_id      UUID        PRIMARY KEY REFERENCES core.communications(id) ON DELETE CASCADE,
  needs_review BOOLEAN     NOT NULL DEFAULT TRUE,
  reviewed_by  UUID        REFERENCES staff.staff_users(id),
  reviewed_at  TIMESTAMPTZ,
  review_notes TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core.document_review_state (
  doc_id                UUID        PRIMARY KEY REFERENCES core.document_files(id) ON DELETE CASCADE,
  is_classified         BOOLEAN     NOT NULL DEFAULT FALSE,
  document_type_code    TEXT        REFERENCES core.document_types(code),
  classification_source TEXT        CHECK (classification_source IN ('manual','auto','ai','rule')),
  classified_at         TIMESTAMPTZ,
  classified_by         UUID        REFERENCES staff.staff_users(id),
  is_reviewed           BOOLEAN     NOT NULL DEFAULT FALSE,
  reviewed_at           TIMESTAMPTZ,
  reviewed_by           UUID        REFERENCES staff.staff_users(id),
  review_notes          TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core.ai_current (
  case_id          UUID  NOT NULL REFERENCES core.cases(id) ON DELETE CASCADE,
  output_type      TEXT  NOT NULL,
  latest_output_id UUID  NOT NULL REFERENCES core.ai_outputs(id) ON DELETE CASCADE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (case_id, output_type)
);

-- Backfill document_review_state from existing document_files
INSERT INTO core.document_review_state (
  doc_id, is_classified, document_type_code, classification_source,
  classified_at, is_reviewed, reviewed_at, review_notes
)
SELECT id, COALESCE(is_classified, FALSE), document_type_code, classification_source,
       classified_at, COALESCE(is_reviewed, FALSE), reviewed_at, review_notes
FROM core.document_files
WHERE is_deleted = FALSE
ON CONFLICT (doc_id) DO NOTHING;

-- Backfill comms_review_state from existing communications
INSERT INTO core.comms_review_state (comm_id, needs_review)
SELECT id, COALESCE(needs_review, FALSE)
FROM core.communications
WHERE is_deleted = FALSE
ON CONFLICT (comm_id) DO NOTHING;

-- Grants on new tables
GRANT SELECT, INSERT, UPDATE ON core.comms_review_state    TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE ON core.document_review_state TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE ON core.ai_current            TO service_role, authenticated;

-- Realtime for new state tables
ALTER TABLE core.comms_review_state    REPLICA IDENTITY FULL;
ALTER TABLE core.document_review_state REPLICA IDENTITY FULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='core' AND tablename='comms_review_state') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE core.comms_review_state;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='core' AND tablename='document_review_state') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE core.document_review_state;
  END IF;
END $$;

-- ── 2. Grant staff schema access ──────────────────────────────

GRANT USAGE ON SCHEMA staff TO authenticated;
GRANT SELECT (id, display_name, email) ON staff.staff_users TO authenticated;

-- ── 3. Fix SECURITY DEFINER views → SECURITY INVOKER ─────────

CREATE OR REPLACE VIEW core.documents_queue WITH (security_invoker = true) AS
SELECT df.id AS doc_id, df.case_id, ca.case_number, ca.case_status, ca.hubspot_deal_id, ca.assigned_attorney,
  su_atty.display_name AS attorney_name,
  TRIM(CONCAT(COALESCE(co.first_name, ca.client_first_name, ''), ' ', COALESCE(co.last_name, ca.client_last_name, ''))) AS client_full_name,
  COALESCE(co.phone, ca.client_phone) AS client_phone,
  df.file_name, df.file_extension, df.source, df.web_url, df.size_bytes, df.created_at_source, df.synced_at, df.created_at,
  COALESCE(drs.is_classified, FALSE) AS is_classified, drs.document_type_code, drs.classification_source, drs.classified_at,
  su_class.display_name AS classified_by_name, COALESCE(drs.is_reviewed, FALSE) AS is_reviewed,
  drs.review_notes, drs.reviewed_at, su_rev.display_name AS reviewed_by_name, cl.status AS checklist_status,
  CASE WHEN COALESCE(drs.is_reviewed,FALSE)=FALSE AND COALESCE(drs.is_classified,FALSE)=FALSE THEN 1
       WHEN COALESCE(drs.is_reviewed,FALSE)=FALSE AND COALESCE(drs.is_classified,FALSE)=TRUE  THEN 2
       WHEN COALESCE(drs.is_reviewed,FALSE)=TRUE THEN 3 ELSE 4 END AS review_sort
FROM core.document_files df
JOIN core.cases ca ON ca.id=df.case_id AND ca.is_deleted=FALSE
LEFT JOIN core.document_review_state drs ON drs.doc_id=df.id
LEFT JOIN core.case_contacts cc ON cc.case_id=ca.id AND cc.is_primary=TRUE AND cc.is_deleted=FALSE
LEFT JOIN core.contacts co ON co.id=cc.contact_id
LEFT JOIN staff.staff_users su_atty ON su_atty.id=ca.assigned_attorney
LEFT JOIN staff.staff_users su_rev ON su_rev.id=drs.reviewed_by
LEFT JOIN staff.staff_users su_class ON su_class.id=drs.classified_by
LEFT JOIN core.case_document_checklist cl ON cl.id=df.checklist_item_id
WHERE df.is_deleted=FALSE;
GRANT SELECT ON core.documents_queue TO service_role, authenticated;

CREATE OR REPLACE VIEW core.case_doc_summary WITH (security_invoker = true) AS
WITH doc_counts AS (
  SELECT df.case_id,
    COUNT(df.id) AS total_docs,
    COUNT(df.id) FILTER (WHERE COALESCE(drs.is_classified,FALSE)=FALSE) AS unclassified,
    COUNT(df.id) FILTER (WHERE COALESCE(drs.is_classified,FALSE)=TRUE AND COALESCE(drs.is_reviewed,FALSE)=FALSE) AS needs_review,
    MAX(df.created_at) FILTER (WHERE df.created_at >= NOW()-INTERVAL '24h') AS recent_upload_at
  FROM core.document_files df
  LEFT JOIN core.document_review_state drs ON drs.doc_id=df.id
  WHERE df.is_deleted=FALSE GROUP BY df.case_id
),
checklist_counts AS (
  SELECT case_id, COUNT(id) FILTER (WHERE status IN ('required','requested') AND is_required=TRUE) AS missing_required
  FROM core.case_document_checklist WHERE is_deleted=FALSE GROUP BY case_id
)
SELECT d.case_id, d.total_docs, d.unclassified, d.needs_review,
  COALESCE(c.missing_required,0) AS missing_required, d.recent_upload_at
FROM doc_counts d LEFT JOIN checklist_counts c ON c.case_id=d.case_id;
GRANT SELECT ON core.case_doc_summary TO service_role, authenticated;

CREATE OR REPLACE VIEW core.comms_inbox WITH (security_invoker = true) AS
SELECT cs.case_id, ca.case_number, ca.case_status, ca.hubspot_deal_id,
  COALESCE(co.first_name,ca.client_first_name) AS client_first_name,
  COALESCE(co.last_name,ca.client_last_name) AS client_last_name,
  TRIM(CONCAT(COALESCE(co.first_name,ca.client_first_name,''),' ',COALESCE(co.last_name,ca.client_last_name,''))) AS client_full_name,
  COALESCE(co.phone,ca.client_phone) AS client_phone, co.email AS client_email,
  ca.assigned_attorney, su.display_name AS attorney_name,
  cs.last_inbound_at, cs.last_outbound_at, cs.last_inbound_channel, cs.awaiting_response,
  cs.response_due_at, cs.sla_status, cs.unread_count, cs.updated_at,
  CASE cs.sla_status WHEN 'overdue' THEN 1 WHEN 'due_soon' THEN 2 WHEN 'ok' THEN 3 ELSE 4 END AS sla_sort
FROM core.comms_state cs
JOIN core.cases ca ON ca.id=cs.case_id AND ca.is_deleted=FALSE
LEFT JOIN core.case_contacts cc ON cc.case_id=ca.id AND cc.is_primary=TRUE AND cc.is_deleted=FALSE
LEFT JOIN core.contacts co ON co.id=cc.contact_id
LEFT JOIN staff.staff_users su ON su.id=ca.assigned_attorney
WHERE cs.last_inbound_at IS NOT NULL;
GRANT SELECT ON core.comms_inbox TO service_role, authenticated;

CREATE OR REPLACE VIEW core.my_work_queue WITH (security_invoker = true) AS
SELECT t.id AS task_id, t.case_id, t.assigned_to, t.created_by, t.title, t.description,
  t.task_type, t.priority, t.task_status, t.due_at, t.created_at, t.updated_at,
  ca.case_number, ca.hubspot_deal_id, ca.case_status,
  TRIM(CONCAT(COALESCE(co.first_name,ca.client_first_name,''),' ',COALESCE(co.last_name,ca.client_last_name,''))) AS client_full_name,
  su_creator.display_name AS created_by_name,
  CASE WHEN t.due_at IS NOT NULL AND t.due_at < NOW() THEN 1
       WHEN t.due_at IS NOT NULL AND t.due_at < NOW()+INTERVAL '1 day' THEN 2
       WHEN t.priority='urgent' THEN 3
       WHEN t.priority='high' AND (t.due_at IS NULL OR t.due_at < NOW()+INTERVAL '7 days') THEN 4
       ELSE 5 END AS urgency_sort
FROM core.tasks t
JOIN core.cases ca ON ca.id=t.case_id AND ca.is_deleted=FALSE
LEFT JOIN core.case_contacts cc ON cc.case_id=ca.id AND cc.is_primary=TRUE AND cc.is_deleted=FALSE
LEFT JOIN core.contacts co ON co.id=cc.contact_id
LEFT JOIN staff.staff_users su_creator ON su_creator.id=t.created_by
WHERE t.is_deleted=FALSE AND t.task_status IN ('open','in_progress','blocked');
GRANT SELECT ON core.my_work_queue TO service_role, authenticated;

-- ── 4. Enable RLS on all tables ───────────────────────────────

ALTER TABLE core.case_intake                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.communications                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.document_files                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.document_types                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.case_document_checklist         ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.tasks                           ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.case_contacts                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.case_documents                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.case_state                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.comms_review_state              ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.comms_state                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.contacts                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.document_collection_state       ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.document_review_state           ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.events                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.hubspot_engagements             ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.intake_sessions                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.intake_batches                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.intake_problems                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.timeline_notes                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.ai_current                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.ai_knowledge_base               ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.ai_outputs                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.sync_log                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.sync_state                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration.hubspot_properties       ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration.hubspot_case_field_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration.hubspot_sync_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_blocked_users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff.staff_roles                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff.staff_users                    ENABLE ROW LEVEL SECURITY;

-- ── 5. RLS policies (staff read access) ───────────────────────

CREATE POLICY "staff_read_case_intake"               ON core.case_intake               FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_communications"            ON core.communications            FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_document_files"            ON core.document_files            FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_document_types"            ON core.document_types            FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_case_document_checklist"   ON core.case_document_checklist   FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_tasks"                     ON core.tasks                     FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_case_contacts"             ON core.case_contacts             FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_case_documents"            ON core.case_documents            FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_case_state"                ON core.case_state                FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_comms_review_state"        ON core.comms_review_state        FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_comms_state"               ON core.comms_state               FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_contacts"                  ON core.contacts                  FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_document_collection_state" ON core.document_collection_state FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_document_review_state"     ON core.document_review_state     FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_events"                    ON core.events                    FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_hubspot_engagements"       ON core.hubspot_engagements       FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_intake_sessions"           ON core.intake_sessions           FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_intake_batches"            ON core.intake_batches            FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_intake_problems"           ON core.intake_problems           FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_timeline_notes"            ON core.timeline_notes            FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_hubspot_properties"        ON integration.hubspot_properties        FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_hubspot_field_mapping"     ON integration.hubspot_case_field_mapping FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_hubspot_sync_log"          ON integration.hubspot_sync_log          FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_staff_roles"               ON staff.staff_roles              FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_read_own_profile"               ON staff.staff_users              FOR SELECT TO authenticated
  USING (email = current_setting('request.jwt.claims', true)::jsonb->>'email');

NOTIFY pgrst, 'reload schema';
