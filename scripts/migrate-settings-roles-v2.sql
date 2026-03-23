-- Add missing portal roles: case_manager, intake, support
-- These match the original inferPortalRole labels used in the UI

INSERT INTO staff.staff_roles
  (role_name, role_level, can_create_cases, can_edit_all_cases, can_delete_cases,
   can_access_financials, can_manage_staff, can_access_ai_tools, can_approve_settlements, description)
VALUES
  ('case_manager', 15, FALSE, TRUE,  FALSE, FALSE, FALSE, FALSE, FALSE, 'Case manager — case oversight and status updates'),
  ('intake',        5, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'Intake specialist — intake queue and document collection'),
  ('support',       3, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'Client support — communications and case status read-only')
ON CONFLICT (role_name) DO NOTHING;
