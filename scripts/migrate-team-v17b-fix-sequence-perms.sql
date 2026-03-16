-- Fix: grant USAGE + SELECT on case_number_seq to service_role and authenticated
-- Without this, upsertCase() fails with "permission denied for sequence case_number_seq"
-- when inserting new deals via the webhook or cron.

GRANT USAGE, SELECT ON SEQUENCE core.case_number_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE core.case_number_seq TO authenticated;

-- Also ensure the trigger function that calls nextval runs with sufficient privileges
ALTER FUNCTION core.generate_case_number() SECURITY DEFINER;
