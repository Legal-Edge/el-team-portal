-- ============================================================
-- Migration: team-v12 — core.comms_inbox view
-- ============================================================
-- Flattened view joining comms_state + cases + contacts + staff.
-- client_full_name pre-computed in DB to avoid app-layer concat.
-- sla_sort column enables priority ordering via PostgREST.
-- Composite index covers full inbox sort pattern.
-- Idempotent publication guard prevents re-run errors.
-- ============================================================

CREATE OR REPLACE VIEW core.comms_inbox AS
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

-- Composite index covering the full inbox sort pattern.
-- unread_count in position 3 enables index-only scans when fetching comms_state rows.
CREATE INDEX IF NOT EXISTS idx_comms_state_inbox
  ON core.comms_state (sla_status, response_due_at, unread_count, updated_at DESC);

-- Idempotent: only add comms_state to Realtime publication if not already a member.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND schemaname = 'core'
    AND tablename = 'comms_state'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE core.comms_state;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
