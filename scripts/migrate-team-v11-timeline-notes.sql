-- ============================================================
-- Migration: team-v11 — core.timeline_notes
-- ============================================================
-- Staff annotation layer, separate from core.events (system bus)
-- and core.communications (actual messages/calls).
--
-- Three-layer case timeline:
--   core.events          → system facts  (automated, append-only)
--   core.communications  → actual comms  (SMS, calls, emails)
--   core.timeline_notes  → human annotations (manual staff input)
--
-- Visibility model (4 levels):
--   public      → all staff + future client portal exposure
--   internal    → all staff, never client-facing (default)
--   restricted  → admin / attorney / manager only (work product, strategy)
--   private     → author only
--
-- API enforces visibility at query time based on session role.
-- No row-level security in DB — enforced in application layer.
-- ============================================================


CREATE TABLE IF NOT EXISTS core.timeline_notes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Required links ─────────────────────────────────────────
  case_id          UUID        NOT NULL REFERENCES core.cases(id) ON DELETE CASCADE,
  author_id        UUID        NOT NULL REFERENCES staff.staff_users(id),

  -- ── Optional links ─────────────────────────────────────────
  contact_id       UUID        REFERENCES core.contacts(id),
  related_comm_id  UUID        REFERENCES core.communications(id) ON DELETE SET NULL,
  related_event_id BIGINT      REFERENCES core.events(id) ON DELETE SET NULL,

  -- ── Classification ─────────────────────────────────────────
  note_type        TEXT        NOT NULL DEFAULT 'general'
                               CHECK (note_type IN (
                                 'general',            -- unclassified staff note
                                 'call_summary',       -- summary of a phone call
                                 'verbal_update',      -- verbal comm not logged elsewhere
                                 'attorney_note',      -- attorney work product / legal analysis
                                 'case_manager_note',  -- case manager status update
                                 'milestone',          -- significant case event worth noting
                                 'client_communication', -- summary of client interaction
                                 'intake_note'         -- note about intake / onboarding
                               )),

  -- ── Visibility ─────────────────────────────────────────────
  -- public     : all staff + future client portal
  -- internal   : all staff, not client-facing (default)
  -- restricted : admin / attorney / manager only
  -- private    : author only
  visibility       TEXT        NOT NULL DEFAULT 'internal'
                               CHECK (visibility IN ('public','internal','restricted','private')),

  -- ── Content ────────────────────────────────────────────────
  body             TEXT        NOT NULL,

  -- ── Editorial ──────────────────────────────────────────────
  is_pinned        BOOLEAN     NOT NULL DEFAULT FALSE,
  edited_at        TIMESTAMPTZ,  -- non-null signals the note has been edited after creation

  -- ── Audit ──────────────────────────────────────────────────
  is_deleted       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ────────────────────────────────────────────────────

-- Primary query: case timeline ordered by time (most recent first)
CREATE INDEX IF NOT EXISTS idx_timeline_notes_case_created
  ON core.timeline_notes (case_id, created_at DESC)
  WHERE is_deleted = FALSE;

-- Pinned notes float to top — separate index for efficient retrieval
CREATE INDEX IF NOT EXISTS idx_timeline_notes_pinned
  ON core.timeline_notes (case_id, is_pinned)
  WHERE is_pinned = TRUE AND is_deleted = FALSE;

-- Author lookup: "all notes by this staff member"
CREATE INDEX IF NOT EXISTS idx_timeline_notes_author
  ON core.timeline_notes (author_id, created_at DESC)
  WHERE is_deleted = FALSE;

-- Visibility filter: restricted notes scoped separately
CREATE INDEX IF NOT EXISTS idx_timeline_notes_visibility
  ON core.timeline_notes (case_id, visibility, created_at DESC)
  WHERE is_deleted = FALSE;

-- ── Trigger ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_timeline_notes_updated_at ON core.timeline_notes;
CREATE TRIGGER trg_timeline_notes_updated_at
  BEFORE UPDATE ON core.timeline_notes
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- ── Grants ─────────────────────────────────────────────────────
GRANT ALL    ON core.timeline_notes TO service_role;
GRANT SELECT ON core.timeline_notes TO authenticated;

ALTER TABLE core.timeline_notes REPLICA IDENTITY FULL;


-- ============================================================
-- UNIFIED CASE TIMELINE QUERY MODEL
-- ============================================================
-- Reference pattern for the /api/cases/[id]/timeline route.
-- Merges all three layers into a single chronological feed.
-- Visibility is enforced via the $role and $staff_id parameters.
--
-- Usage:
--   SELECT * FROM core.case_timeline_feed($case_id, $role, $staff_id, $limit, $before_ts)
--
-- Three sources unified by (ts, source, item_type):
--   source = 'event'  → system facts from core.events
--   source = 'comm'   → messages/calls from core.communications
--   source = 'note'   → staff annotations from core.timeline_notes

CREATE OR REPLACE FUNCTION core.case_timeline_feed(
  p_case_id   UUID,
  p_role      TEXT,           -- session user role: 'admin','attorney','manager','paralegal','staff'
  p_staff_id  UUID,           -- session user id (for private note visibility)
  p_limit     INT  DEFAULT 50,
  p_before_ts TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  source      TEXT,
  id          TEXT,
  ts          TIMESTAMPTZ,
  item_type   TEXT,
  body        TEXT,
  author_ref  TEXT,
  visibility  TEXT,
  is_pinned   BOOLEAN,
  payload     JSONB
) LANGUAGE sql STABLE AS $$
  -- System events
  SELECT
    'event'          AS source,
    e.id::TEXT       AS id,
    e.occurred_at    AS ts,
    e.event_type     AS item_type,
    NULL::TEXT       AS body,
    e.actor          AS author_ref,
    'internal'::TEXT AS visibility,
    FALSE            AS is_pinned,
    e.payload        AS payload
  FROM core.events e
  WHERE e.case_id = p_case_id
    AND e.occurred_at < p_before_ts

  UNION ALL

  -- Communications
  SELECT
    'comm'           AS source,
    c.id::TEXT,
    c.occurred_at    AS ts,
    c.channel        AS item_type,
    c.snippet        AS body,
    COALESCE(c.sender_email, c.from_number) AS author_ref,
    CASE WHEN c.is_internal THEN 'internal' ELSE 'public' END AS visibility,
    FALSE            AS is_pinned,
    NULL::JSONB      AS payload
  FROM core.communications c
  WHERE c.case_id   = p_case_id
    AND c.is_deleted = FALSE
    AND c.occurred_at < p_before_ts

  UNION ALL

  -- Staff annotations (visibility-filtered)
  SELECT
    'note'           AS source,
    n.id::TEXT,
    n.created_at     AS ts,
    n.note_type      AS item_type,
    n.body,
    n.author_id::TEXT AS author_ref,
    n.visibility,
    n.is_pinned,
    NULL::JSONB      AS payload
  FROM core.timeline_notes n
  WHERE n.case_id    = p_case_id
    AND n.is_deleted = FALSE
    AND n.created_at < p_before_ts
    AND (
      -- public + internal: all staff
      n.visibility IN ('public', 'internal')
      OR
      -- restricted: elevated roles only
      (n.visibility = 'restricted' AND p_role IN ('admin', 'attorney', 'manager'))
      OR
      -- private: author only
      (n.visibility = 'private' AND n.author_id = p_staff_id)
    )

  ) feed
  -- Wrap in subquery so ORDER BY can reference column names across UNION branches.
  -- is_pinned DESC floats pinned notes to top; ts DESC for chronological ordering.
  -- Pagination caveat: p_before_ts cursor breaks for pinned notes with old ts on page 2+.
  -- Revisit when building timeline UI (separate pinned fetch + paginate rest).
  ORDER BY feed.is_pinned DESC, feed.ts DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION core.case_timeline_feed TO service_role, authenticated;


NOTIFY pgrst, 'reload schema';
