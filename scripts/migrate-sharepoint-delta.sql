-- migrate-sharepoint-delta.sql
-- Seeds the delta link key in core.sync_state for SharePoint drive delta tracking.
-- Run in Supabase SQL Editor.
--
-- This is used by /api/admin/cron/sharepoint-delta and the SharePoint webhook handler.
-- On first run of the delta cron, this null value triggers initialization:
--   GET /drives/{driveId}/root/delta?token=latest  →  stores a real deltaLink
-- Subsequent runs use the stored deltaLink to fetch only changed items.

INSERT INTO core.sync_state (key, value, updated_at)
VALUES ('sharepoint_drive_delta_link', null, now())
ON CONFLICT (key) DO NOTHING;
