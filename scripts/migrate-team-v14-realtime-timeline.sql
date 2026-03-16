-- ============================================================
-- Migration: team-v14 — Realtime for unified case timeline tables
-- ============================================================
-- Enables live updates on core.communications, core.events,
-- and core.timeline_notes for the unified case timeline.
-- All three tables need REPLICA IDENTITY FULL + publication membership.
-- Uses idempotent guards (same pattern as team-v12).
-- ============================================================

-- core.communications — REPLICA IDENTITY (required for Realtime row delivery)
ALTER TABLE core.communications REPLICA IDENTITY FULL;

-- core.events — REPLICA IDENTITY
ALTER TABLE core.events REPLICA IDENTITY FULL;

-- core.timeline_notes — already set in team-v11, ensure idempotent
ALTER TABLE core.timeline_notes REPLICA IDENTITY FULL;

-- Add all three to Realtime publication (idempotent guards)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND schemaname = 'core' AND tablename = 'communications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE core.communications;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND schemaname = 'core' AND tablename = 'events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE core.events;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND schemaname = 'core' AND tablename = 'timeline_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE core.timeline_notes;
  END IF;
END $$;

-- Verify (returns table rows if successful)
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'core'
ORDER BY tablename;
