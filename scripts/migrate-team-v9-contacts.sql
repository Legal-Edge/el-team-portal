-- ============================================================
-- Migration: team-v9 — core.contacts (canonical person record)
-- ============================================================
-- 1. Create core.contacts
-- 2. Add contact_id FK to core.case_contacts
-- 3. Backfill: one contact per unique hubspot_contact_id
-- 4. Link case_contacts → contacts
-- 5. Verification counts
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. core.contacts — canonical person record
-- ═══════════════════════════════════════════════════════════════
-- Design principles:
--   • hubspot_contact_id is the primary dedupe anchor (globally unique in HubSpot)
--   • phone + email are lookup indexes, NOT unique constraints:
--     family members can share a number; people can share email accounts.
--   • This table is source-agnostic — contacts from portal, referrals,
--     manual entry all land here with source_system tracking.

CREATE TABLE IF NOT EXISTS core.contacts (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Identity anchors ───────────────────────────────────────
  hubspot_contact_id   TEXT,                        -- HubSpot contact record ID
  email                TEXT,                        -- lowercase-normalized
  phone                TEXT,                        -- E.164 normalized (+1XXXXXXXXXX)

  -- ── Name ───────────────────────────────────────────────────
  first_name           TEXT,
  last_name            TEXT,

  -- ── Preferences ────────────────────────────────────────────
  preferred_channel    TEXT        CHECK (preferred_channel IN ('sms','call','email')),
  do_not_contact       BOOLEAN     NOT NULL DEFAULT FALSE,
  time_zone            TEXT,

  -- ── Source tracking ────────────────────────────────────────
  source_system        TEXT        NOT NULL DEFAULT 'hubspot'
                                   CHECK (source_system IN ('hubspot','portal','referral','manual','backfill')),

  -- ── Audit ──────────────────────────────────────────────────
  is_deleted           BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ────────────────────────────────────────────────────

-- hubspot_contact_id: partial unique — one canonical record per HubSpot contact
CREATE UNIQUE INDEX IF NOT EXISTS uidx_contacts_hubspot_id
  ON core.contacts (hubspot_contact_id)
  WHERE hubspot_contact_id IS NOT NULL;

-- phone + email: lookup only, not unique (family members can share)
CREATE INDEX IF NOT EXISTS idx_contacts_phone
  ON core.contacts (phone)
  WHERE phone IS NOT NULL AND is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_contacts_email
  ON core.contacts (email)
  WHERE email IS NOT NULL AND is_deleted = FALSE;

-- ── Trigger ────────────────────────────────────────────────────
CREATE TRIGGER trg_contacts_updated_at
  BEFORE UPDATE ON core.contacts
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- ── Grants ─────────────────────────────────────────────────────
GRANT ALL    ON core.contacts TO service_role;
GRANT SELECT ON core.contacts TO authenticated;

-- Realtime
ALTER TABLE core.contacts REPLICA IDENTITY FULL;


-- ═══════════════════════════════════════════════════════════════
-- 2. Add contact_id FK to core.case_contacts
-- ═══════════════════════════════════════════════════════════════
-- This is the link between case-scoped contact data and the canonical record.

ALTER TABLE core.case_contacts
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES core.contacts(id);

CREATE INDEX IF NOT EXISTS idx_case_contacts_contact_id
  ON core.case_contacts (contact_id)
  WHERE contact_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════
-- 3. BACKFILL — one contact per unique hubspot_contact_id
-- ═══════════════════════════════════════════════════════════════
-- Strategy:
--   • Group all case_contacts by hubspot_contact_id
--   • For each group, take the most recently updated row as the canonical
--     source of truth for name / phone / email
--   • Phone is normalised to E.164 inline: strip non-digits, prepend +1
--     (handles common formats: (310)555-1234, 310-555-1234, 3105551234)
--
-- This is a one-time bulk INSERT. Going forward, the sync pipeline
-- (lib/pipelines/hubspot.ts) is responsible for upsert-on-conflict.

INSERT INTO core.contacts (
  hubspot_contact_id,
  first_name,
  last_name,
  email,
  phone,
  source_system,
  created_at,
  updated_at
)
SELECT DISTINCT ON (hubspot_contact_id)
  hubspot_contact_id,
  first_name,
  last_name,
  LOWER(TRIM(email))                            AS email,
  -- Normalize to E.164: keep digits only, prepend +1 if 10 digits
  CASE
    WHEN phone IS NULL OR TRIM(phone) = ''
      THEN NULL
    WHEN LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) = 11
      AND LEFT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 1) = '1'
      THEN CONCAT('+',  REGEXP_REPLACE(phone, '[^0-9]', '', 'g'))
    WHEN LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) = 10
      THEN CONCAT('+1', REGEXP_REPLACE(phone, '[^0-9]', '', 'g'))
    ELSE phone   -- keep as-is if format unknown (data quality flag)
  END                                           AS phone,
  'backfill'                                    AS source_system,
  MIN(created_at) OVER (PARTITION BY hubspot_contact_id) AS created_at,
  MAX(updated_at) OVER (PARTITION BY hubspot_contact_id) AS updated_at
FROM core.case_contacts
WHERE is_deleted = FALSE
ORDER BY hubspot_contact_id, updated_at DESC
ON CONFLICT (hubspot_contact_id)
  WHERE hubspot_contact_id IS NOT NULL
  DO NOTHING;   -- idempotent: safe to re-run


-- ═══════════════════════════════════════════════════════════════
-- 4. LINK case_contacts → contacts
-- ═══════════════════════════════════════════════════════════════
-- All case_contacts have hubspot_contact_id NOT NULL, so every row
-- should resolve to a canonical contact after the backfill above.

UPDATE core.case_contacts cc
SET    contact_id = c.id,
       updated_at = NOW()
FROM   core.contacts c
WHERE  cc.hubspot_contact_id = c.hubspot_contact_id
  AND  c.hubspot_contact_id IS NOT NULL
  AND  cc.contact_id IS NULL;


-- ═══════════════════════════════════════════════════════════════
-- 5. VERIFICATION — run these SELECT queries to confirm results
-- ═══════════════════════════════════════════════════════════════

-- (a) Unique contacts created
SELECT
  COUNT(*)               AS total_contacts,
  COUNT(phone)           AS with_phone,
  COUNT(email)           AS with_email,
  COUNT(first_name)      AS with_name
FROM core.contacts
WHERE is_deleted = FALSE;

-- (b) case_contacts linkage
SELECT
  COUNT(*)                                   AS total_case_contacts,
  COUNT(contact_id)                          AS linked,
  COUNT(*) - COUNT(contact_id)               AS unlinked,
  ROUND(COUNT(contact_id)::NUMERIC
    / NULLIF(COUNT(*), 0) * 100, 2)          AS pct_linked
FROM core.case_contacts
WHERE is_deleted = FALSE;

-- (c) Contacts with multiple cases (top 10 most-cased clients)
SELECT
  co.id,
  co.first_name,
  co.last_name,
  co.hubspot_contact_id,
  COUNT(DISTINCT cc.case_id) AS case_count
FROM core.contacts co
JOIN core.case_contacts cc ON cc.contact_id = co.id
WHERE co.is_deleted = FALSE
GROUP BY co.id, co.first_name, co.last_name, co.hubspot_contact_id
HAVING COUNT(DISTINCT cc.case_id) > 1
ORDER BY case_count DESC
LIMIT 10;

-- (d) Unlinked case_contacts (should be 0)
SELECT
  cc.id,
  cc.hubspot_contact_id,
  cc.case_id
FROM core.case_contacts cc
WHERE cc.contact_id IS NULL
  AND cc.is_deleted = FALSE
LIMIT 20;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
