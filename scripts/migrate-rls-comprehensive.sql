-- ============================================================
-- Migration: rls-comprehensive
-- Enable RLS on ALL remaining tables not yet covered.
-- Covers current linter batch + all remaining tables proactively.
--
-- Architecture:
--   • All app API routes use service_role → bypasses RLS automatically
--   • Realtime SSE proxy uses service_role → bypasses RLS automatically
--   • Authenticated role (portal staff) does NOT query Supabase directly
--     — all reads go through Next.js API routes (service_role)
--
-- Policy pattern:
--   • Operational core tables  → staff SELECT USING (true) [in case of
--     future direct queries or Realtime client-side subscriptions]
--   • Internal/system tables   → RLS enabled, no authenticated policy
--     (service_role only; blocks any direct PostgREST access)
--   • Reference/config tables  → staff SELECT USING (true)
-- ============================================================

-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Current linter batch (5 tables)                           ║
-- ╚══════════════════════════════════════════════════════════════╝

-- integration.hubspot_properties — reference data, staff can read
ALTER TABLE integration.hubspot_properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_hubspot_properties"
  ON integration.hubspot_properties FOR SELECT TO authenticated USING (true);

-- core.document_types — reference/config, staff can read
ALTER TABLE core.document_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_document_types"
  ON core.document_types FOR SELECT TO authenticated USING (true);

-- core.case_document_checklist — operational, staff can read
ALTER TABLE core.case_document_checklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_case_document_checklist"
  ON core.case_document_checklist FOR SELECT TO authenticated USING (true);

-- core.document_files — operational, staff can read
ALTER TABLE core.document_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_document_files"
  ON core.document_files FOR SELECT TO authenticated USING (true);

-- core.tasks — operational, staff can read
ALTER TABLE core.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_tasks"
  ON core.tasks FOR SELECT TO authenticated USING (true);


-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Remaining operational tables (proactive coverage)         ║
-- ╚══════════════════════════════════════════════════════════════╝

-- core.case_contacts
ALTER TABLE core.case_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_case_contacts"
  ON core.case_contacts FOR SELECT TO authenticated USING (true);

-- core.case_documents (legacy doc reference table)
ALTER TABLE core.case_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_case_documents"
  ON core.case_documents FOR SELECT TO authenticated USING (true);

-- core.case_state
ALTER TABLE core.case_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_case_state"
  ON core.case_state FOR SELECT TO authenticated USING (true);

-- core.comms_review_state
ALTER TABLE core.comms_review_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_comms_review_state"
  ON core.comms_review_state FOR SELECT TO authenticated USING (true);

-- core.comms_state
ALTER TABLE core.comms_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_comms_state"
  ON core.comms_state FOR SELECT TO authenticated USING (true);

-- core.contacts
ALTER TABLE core.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_contacts"
  ON core.contacts FOR SELECT TO authenticated USING (true);

-- core.document_collection_state
ALTER TABLE core.document_collection_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_document_collection_state"
  ON core.document_collection_state FOR SELECT TO authenticated USING (true);

-- core.document_review_state
ALTER TABLE core.document_review_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_document_review_state"
  ON core.document_review_state FOR SELECT TO authenticated USING (true);

-- core.events
ALTER TABLE core.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_events"
  ON core.events FOR SELECT TO authenticated USING (true);

-- core.hubspot_engagements — timeline data, staff can read
ALTER TABLE core.hubspot_engagements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_hubspot_engagements"
  ON core.hubspot_engagements FOR SELECT TO authenticated USING (true);

-- core.intake_sessions
ALTER TABLE core.intake_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_intake_sessions"
  ON core.intake_sessions FOR SELECT TO authenticated USING (true);

-- core.intake_batches
ALTER TABLE core.intake_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_intake_batches"
  ON core.intake_batches FOR SELECT TO authenticated USING (true);

-- core.intake_problems
ALTER TABLE core.intake_problems ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_intake_problems"
  ON core.intake_problems FOR SELECT TO authenticated USING (true);

-- core.timeline_notes
ALTER TABLE core.timeline_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_timeline_notes"
  ON core.timeline_notes FOR SELECT TO authenticated USING (true);


-- ╔══════════════════════════════════════════════════════════════╗
-- ║  Internal / system tables — RLS only, no authenticated     ║
-- ║  policy (service_role access only; blocks PostgREST)       ║
-- ╚══════════════════════════════════════════════════════════════╝

-- core.ai_current — AI engine internal state
ALTER TABLE core.ai_current ENABLE ROW LEVEL SECURITY;

-- core.ai_knowledge_base — AI knowledge store
ALTER TABLE core.ai_knowledge_base ENABLE ROW LEVEL SECURITY;

-- core.ai_outputs — AI result cache
ALTER TABLE core.ai_outputs ENABLE ROW LEVEL SECURITY;

-- core.sync_log — internal delta sync audit
ALTER TABLE core.sync_log ENABLE ROW LEVEL SECURITY;

-- core.sync_state — persistent cursor/state for crons
ALTER TABLE core.sync_state ENABLE ROW LEVEL SECURITY;

-- portal_blocked_users — auth management
ALTER TABLE portal_blocked_users ENABLE ROW LEVEL SECURITY;

-- staff.staff_roles — managed via service_role only
ALTER TABLE staff.staff_roles ENABLE ROW LEVEL SECURITY;
-- Staff can read roles (needed for role name display)
CREATE POLICY "staff_read_staff_roles"
  ON staff.staff_roles FOR SELECT TO authenticated USING (true);

-- staff.staff_users — managed via service_role only; staff cannot
-- query the full user list directly (only their own session via NextAuth)
ALTER TABLE staff.staff_users ENABLE ROW LEVEL SECURITY;
-- Allow staff to read their own profile row
CREATE POLICY "staff_read_own_profile"
  ON staff.staff_users FOR SELECT TO authenticated
  USING (email = current_setting('request.jwt.claims', true)::jsonb->>'email');


-- ── Reload PostgREST schema cache ──────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
