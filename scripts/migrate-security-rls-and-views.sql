-- ============================================================
-- Migration: security-rls-and-views
-- Fix: Supabase security linter errors
--
-- 1. core.my_work_queue   — SECURITY DEFINER view → INVOKER
-- 2. core.case_intake     — Enable RLS (deprecated table, read-only)
-- 3. core.communications  — Enable RLS (service_role only write)
-- 4. integration.hubspot_case_field_mapping — Enable RLS
-- 5. integration.hubspot_sync_log           — Enable RLS
--
-- All app code uses service_role, which bypasses RLS automatically.
-- Authenticated (staff portal) gets scoped read policies where needed.
-- ============================================================

-- ── 1. core.my_work_queue — add WITH (security_invoker = true) ─────────────
CREATE OR REPLACE VIEW core.my_work_queue
WITH (security_invoker = true)
AS
SELECT
  t.id                                             AS task_id,
  t.case_id,
  t.assigned_to,
  t.created_by,
  t.title,
  t.description,
  t.task_type,
  t.priority,
  t.task_status,
  t.due_at,
  t.created_at,
  t.updated_at,

  -- Case context
  ca.case_number,
  ca.hubspot_deal_id,
  ca.case_status,

  -- Client name
  TRIM(CONCAT(
    COALESCE(co.first_name, ca.client_first_name, ''), ' ',
    COALESCE(co.last_name,  ca.client_last_name,  '')
  ))                                               AS client_full_name,

  -- Creator name
  su_creator.display_name                          AS created_by_name,

  -- Urgency sort: 1=overdue, 2=due today, 3=urgent, 4=high+this week, 5=other
  CASE
    WHEN t.due_at IS NOT NULL AND t.due_at < NOW()                         THEN 1
    WHEN t.due_at IS NOT NULL AND t.due_at < NOW() + INTERVAL '1 day'     THEN 2
    WHEN t.priority = 'urgent'                                             THEN 3
    WHEN t.priority = 'high'
      AND (t.due_at IS NULL OR t.due_at < NOW() + INTERVAL '7 days')      THEN 4
    ELSE 5
  END                                              AS urgency_sort

FROM core.tasks t
JOIN core.cases ca
  ON ca.id = t.case_id AND ca.is_deleted = FALSE
LEFT JOIN core.case_contacts cc
  ON cc.case_id = ca.id AND cc.is_primary = TRUE AND cc.is_deleted = FALSE
LEFT JOIN core.contacts co
  ON co.id = cc.contact_id
LEFT JOIN staff.staff_users su_creator
  ON su_creator.id = t.created_by
WHERE t.is_deleted   = FALSE
  AND t.task_status IN ('open', 'in_progress', 'blocked');

GRANT SELECT ON core.my_work_queue TO service_role, authenticated;


-- ── 2. core.case_intake — Enable RLS ──────────────────────────────────────
-- Deprecated table (superseded by intake_sessions in v10).
-- Still queried by /api/cases/[id] route via service_role.
-- Authenticated users get read access; service_role bypasses RLS.

ALTER TABLE core.case_intake ENABLE ROW LEVEL SECURITY;

-- Allow authenticated staff to read intake data (all rows — staff portal
-- already enforces case access at the application layer)
CREATE POLICY "staff_can_read_case_intake"
  ON core.case_intake
  FOR SELECT
  TO authenticated
  USING (true);

-- service_role bypasses RLS automatically — no explicit policy needed.


-- ── 3. core.communications — Enable RLS ───────────────────────────────────
-- Legacy comms table (being deprecated in favour of hubspot_engagements).
-- All writes go through service_role. Authenticated gets read.

ALTER TABLE core.communications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_can_read_communications"
  ON core.communications
  FOR SELECT
  TO authenticated
  USING (true);


-- ── 4. integration.hubspot_case_field_mapping — Enable RLS ────────────────
-- Config/mapping table. Read-only for staff; service_role manages it.

ALTER TABLE integration.hubspot_case_field_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_can_read_hubspot_field_mapping"
  ON integration.hubspot_case_field_mapping
  FOR SELECT
  TO authenticated
  USING (true);


-- ── 5. integration.hubspot_sync_log — Enable RLS ──────────────────────────
-- Internal sync audit log. Admins/staff can read; only service_role writes.

ALTER TABLE integration.hubspot_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_can_read_hubspot_sync_log"
  ON integration.hubspot_sync_log
  FOR SELECT
  TO authenticated
  USING (true);


-- ── Reload schema cache ────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
