-- Portal-level user block list
-- Blocks specific Azure users from accessing the team portal
-- Does NOT affect their Azure AD account — portal access only

CREATE TABLE IF NOT EXISTS portal_blocked_users (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  email      text        UNIQUE NOT NULL,
  name       text,
  blocked_by text,
  blocked_at timestamptz DEFAULT now(),
  reason     text
);

CREATE INDEX IF NOT EXISTS idx_portal_blocked_users_email ON portal_blocked_users (lower(email));
