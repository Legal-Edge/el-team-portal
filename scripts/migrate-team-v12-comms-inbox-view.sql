-- ============================================================
-- Migration: team-v12 — core.comms_inbox view
-- ============================================================
-- Flattened view joining comms_state + cases + contacts + staff
-- for efficient inbox queries without multi-table joins in app code.
-- sla_sort column enables priority ordering via PostgREST.
-- ============================================================

CREATE OR REPLACE VIEW core.comms_inbox AS
SELECT
  cs.case_id,
  ca.case_number,
  ca.case_status,
  ca.hubspot_deal_id,

  -- Client identity: prefer canonical contact, fall back to denormalized case fields
  COALESCE(co.first_name, ca.client_first_name)  AS client_first_name,
  COALESCE(co.last_name,  ca.client_last_name)   AS client_last_name,
  COALESCE(co.phone,      ca.client_phone)        AS client_phone,
  co.email                                        AS client_email,

  -- Attorney assignment
  ca.assigned_attorney,
  su.display_name                                 AS attorney_name,

  -- Comms state
  cs.last_inbound_at,
  cs.last_outbound_at,
  cs.last_inbound_channel,
  cs.awaiting_response,
  cs.response_due_at,
  cs.sla_status,
  cs.unread_count,
  cs.updated_at,

  -- Sort helper: enables ORDER BY sla_sort ASC via PostgREST
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

-- Only cases with actual communications
WHERE cs.last_inbound_at IS NOT NULL;

GRANT SELECT ON core.comms_inbox TO service_role, authenticated;

-- Enable Realtime on comms_state so the inbox updates live
-- (REPLICA IDENTITY FULL already set in team-v6)
ALTER PUBLICATION supabase_realtime ADD TABLE core.comms_state;

NOTIFY pgrst, 'reload schema';
