-- ═══════════════════════════════════════════════════════════════
-- Phase 1: Case Document Layer
-- Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- ── 1. document_types ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS core.document_types (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  TEXT UNIQUE NOT NULL,
  label                 TEXT NOT NULL,
  description           TEXT,
  is_required_default   BOOLEAN DEFAULT FALSE,
  required_for_stages   TEXT[] DEFAULT '{}',
  sort_order            INTEGER DEFAULT 0,
  is_active             BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO core.document_types
  (code, label, description, is_required_default, required_for_stages, sort_order)
VALUES
  ('repair_order',              'Repair Order(s)',              'Dealer repair orders documenting work performed on the vehicle',      TRUE,  ARRAY['document_collection'], 1),
  ('purchase_agreement',        'Purchase/Lease Agreement',     'Original vehicle purchase or lease contract',                          TRUE,  ARRAY['document_collection'], 2),
  ('warranty_doc',              'Warranty Documentation',       'Manufacturer warranty card or coverage documentation',                 TRUE,  ARRAY['document_collection'], 3),
  ('odometer_disclosure',       'Odometer Disclosure',          'Odometer reading disclosure at time of purchase',                      FALSE, ARRAY['document_collection'], 4),
  ('dealer_correspondence',     'Dealer Correspondence',        'Letters, emails, or written communication with the dealer',            FALSE, ARRAY['document_collection'], 5),
  ('manufacturer_correspondence','Manufacturer Correspondence', 'Letters, emails, or written communication with the manufacturer',      FALSE, ARRAY['document_collection'], 6),
  ('diagnostic_report',         'Diagnostic Report',            'Dealer diagnostic scan or technical report',                           FALSE, ARRAY['document_collection'], 7),
  ('loaner_records',            'Loaner Vehicle Records',       'Records of loaner vehicle provided during repairs',                    FALSE, ARRAY['document_collection'], 8),
  ('payment_records',           'Repair Payment Records',       'Receipts or invoices for out-of-pocket repair costs',                  FALSE, ARRAY['document_collection'], 9),
  ('client_id',                 'Client ID',                    'Government-issued photo identification',                               FALSE, ARRAY['document_collection'], 10),
  ('photos',                    'Photos of Defects',            'Photographs documenting the vehicle defects',                          FALSE, ARRAY['document_collection'], 11),
  ('other',                     'Other',                        'Any other relevant documentation',                                     FALSE, ARRAY['document_collection'], 12)
ON CONFLICT (code) DO NOTHING;

-- ── 2. case_document_checklist ─────────────────────────────────
CREATE TABLE IF NOT EXISTS core.case_document_checklist (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id               UUID NOT NULL REFERENCES core.cases(id) ON DELETE CASCADE,
  document_type_code    TEXT NOT NULL REFERENCES core.document_types(code),

  status TEXT NOT NULL DEFAULT 'required',
  CONSTRAINT checklist_status_check CHECK (
    status IN ('required','requested','received','under_review','approved','rejected','waived')
  ),

  is_required           BOOLEAN DEFAULT TRUE,
  requested_at          TIMESTAMPTZ,
  received_at           TIMESTAMPTZ,
  approved_at           TIMESTAMPTZ,
  notes                 TEXT,

  -- Audit
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  created_by            TEXT,
  updated_by            TEXT,
  is_deleted            BOOLEAN DEFAULT FALSE,

  CONSTRAINT checklist_unique UNIQUE (case_id, document_type_code)
);

CREATE INDEX IF NOT EXISTS idx_checklist_case_id ON core.case_document_checklist(case_id);
CREATE INDEX IF NOT EXISTS idx_checklist_status  ON core.case_document_checklist(status);

GRANT ALL    ON core.case_document_checklist TO service_role;
GRANT SELECT ON core.case_document_checklist TO authenticated;

-- ── 3. Extend core.case_documents ─────────────────────────────
-- (table created in migrate-sharepoint.sql — extend it here)
ALTER TABLE core.case_documents
  ADD COLUMN IF NOT EXISTS checklist_item_id      UUID REFERENCES core.case_document_checklist(id),
  ADD COLUMN IF NOT EXISTS document_type_code     TEXT REFERENCES core.document_types(code),
  ADD COLUMN IF NOT EXISTS is_classified          BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS classified_by          TEXT,
  ADD COLUMN IF NOT EXISTS classified_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS classification_source  TEXT;
  -- classification_source values: 'manual' | 'auto' | 'ai'

CREATE INDEX IF NOT EXISTS idx_case_docs_type        ON core.case_documents(document_type_code);
CREATE INDEX IF NOT EXISTS idx_case_docs_classified  ON core.case_documents(is_classified);

NOTIFY pgrst, 'reload schema';
