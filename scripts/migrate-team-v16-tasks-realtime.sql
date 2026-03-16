-- ============================================================
-- Migration: team-v16 — tasks Realtime + my_work_queue view
-- ============================================================
-- Enables Supabase Realtime on core.tasks so task changes
-- appear live on case detail and My Work queue.
-- Also creates core.my_work_queue view: tasks assigned to a
-- specific staff member, enriched with case + client context.
-- ============================================================

-- ── 1. REPLICA IDENTITY FULL for tasks ───────────────────────

ALTER TABLE core.tasks REPLICA IDENTITY FULL;

-- ── 2. Idempotent publication guard ───────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'core' AND tablename = 'tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE core.tasks;
  END IF;
END $$;

-- ── 3. My work queue view ─────────────────────────────────────
-- One row per open/in_progress/blocked task assigned to staff.
-- Filtered to non-deleted, non-cancelled, non-completed.
-- Join brings in case number, client name, stage for context.

CREATE OR REPLACE VIEW core.my_work_queue AS
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

  -- Urgency sort:
  --  1 = overdue (due_at < now)
  --  2 = due today
  --  3 = urgent priority
  --  4 = high priority + due this week
  --  5 = everything else
  CASE
    WHEN t.due_at IS NOT NULL AND t.due_at < NOW()                          THEN 1
    WHEN t.due_at IS NOT NULL AND t.due_at < NOW() + INTERVAL '1 day'      THEN 2
    WHEN t.priority = 'urgent'                                              THEN 3
    WHEN t.priority = 'high'
      AND (t.due_at IS NULL OR t.due_at < NOW() + INTERVAL '7 days')       THEN 4
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

-- ── 4. Index to support my work queue lookups ─────────────────

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status_due
  ON core.tasks (assigned_to, task_status, due_at)
  WHERE is_deleted = FALSE;

-- ── 5. Verify ─────────────────────────────────────────────────

SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'core'
ORDER BY tablename;

NOTIFY pgrst, 'reload schema';
