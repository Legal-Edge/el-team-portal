-- migrate-case-views.sql
-- Saved views / custom filter configs for the HubSpot-style case queue

CREATE TABLE IF NOT EXISTS staff.case_views (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT        NOT NULL,
  owner_id       UUID        REFERENCES staff.staff_users(id) ON DELETE SET NULL,
  is_team_preset BOOLEAN     NOT NULL DEFAULT FALSE,
  stage_tab      TEXT,
  columns        JSONB       NOT NULL DEFAULT '[]',
  filters        JSONB       NOT NULL DEFAULT '[]',
  sort_by        TEXT        NOT NULL DEFAULT 'notes_last_updated',
  sort_dir       TEXT        NOT NULL DEFAULT 'desc',
  position       INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE staff.case_views ENABLE ROW LEVEL SECURITY;

GRANT ALL    ON staff.case_views TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON staff.case_views TO authenticated;

-- Team presets visible to all; personal views visible only to owner
CREATE POLICY "team_presets_visible_to_all" ON staff.case_views
  FOR SELECT USING (is_team_preset = TRUE);

CREATE POLICY "personal_views_owner_only" ON staff.case_views
  FOR SELECT USING (is_team_preset = FALSE AND owner_id = auth.uid()::uuid);

CREATE POLICY "owner_can_insert" ON staff.case_views
  FOR INSERT WITH CHECK (owner_id = auth.uid()::uuid);

CREATE POLICY "owner_can_update" ON staff.case_views
  FOR UPDATE USING (owner_id = auth.uid()::uuid);

CREATE POLICY "owner_can_delete" ON staff.case_views
  FOR DELETE USING (owner_id = auth.uid()::uuid);

NOTIFY pgrst, 'reload schema';
