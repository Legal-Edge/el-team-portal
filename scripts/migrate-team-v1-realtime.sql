-- Migration team-v1: Enable Supabase Realtime on core.cases
-- Required for SSE-proxied live updates on case queue and case detail pages.
--
-- Run in Supabase SQL Editor before deploying Phase 2.

-- 1. Full row data on UPDATE/DELETE events (required for server-side filtering)
ALTER TABLE core.cases REPLICA IDENTITY FULL;

-- 2. Add core.cases to the Supabase Realtime publication
--    (Run only if not already present — will error safely if already added)
ALTER PUBLICATION supabase_realtime ADD TABLE core.cases;
