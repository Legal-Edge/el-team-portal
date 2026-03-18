-- ─────────────────────────────────────────────────────────────────────────────
-- Pending KB Rules — run all 4 in Supabase SQL editor
-- Project: Easy Lemon Team Portal → core.ai_knowledge_base
-- ─────────────────────────────────────────────────────────────────────────────


-- ── Rule 1: JLR (Jaguar / Land Rover) RO date format ─────────────────────────
INSERT INTO core.ai_knowledge_base (
  category, title, content, applies_to, doc_types, is_active, sort_order, created_by
) VALUES (
  'extraction_rules',
  'JLR RO date format: HH:MM DDMONYY (R.O. OPENED / READY)',
  'Jaguar/Land Rover repair orders use format HH:MM DDMONYY (e.g. "10:50 06JAN26", "16:08 06JAN26").

Rules:
- IGNORE the HH:MM time prefix entirely — it is NOT part of the date.
- Parse DDMONYY: DD=day (2 digits), MON=3-letter month abbreviation, YY=2-digit year always 20YY (26=2026, 25=2025).
- R.O. OPENED field = repair_date_in (e.g. "10:50 06JAN26" = 2026-01-06)
- READY field = repair_date_out (e.g. "16:08 06JAN26" = 2026-01-06)
- MILEAGE IN = mileage_in, MILEAGE OUT = mileage_out
- NEVER use the time digits (10, 16, etc.) as the day number.',
  ARRAY['extraction'],
  ARRAY['repair_order'],
  true,
  10,
  'axe-manual'
)
ON CONFLICT DO NOTHING;


-- ── Rule 2: FCA/Stellantis "CUSTOMER STATES" line is always Complaint ─────────
-- Applies to: Chrysler / Dodge / Jeep / RAM / Alfa Romeo dealers (Stellantis/FCA)
-- Bug observed: Haiku was placing "CUSTOMER STATES: ..." text into diagnosis instead of complaint
INSERT INTO core.ai_knowledge_base (
  category, title, content, applies_to, doc_types, is_active, sort_order, created_by
) VALUES (
  'extraction_rules',
  'FCA/Stellantis ROs: "CUSTOMER STATES:" lines are always the Complaint',
  'On FCA/Stellantis dealer repair orders (Chrysler, Dodge, Jeep, RAM, Alfa Romeo), repair lines use a 3-part structure:
- Line A (Concern/Complaint): begins with "CUSTOMER STATES:" followed by the customer description
- Line B (Cause/Diagnosis): technician findings
- Line C (Correction): work performed

Rules:
- ANY line starting with "CUSTOMER STATES:" is ALWAYS the complaint field — never the diagnosis
- If multiple "CUSTOMER STATES:" lines exist (multiple repair concerns), concatenate them with " | " separator
- The diagnosis (cause) comes from the technician note on the line that follows the CUSTOMER STATES line
- Do NOT confuse "CUSTOMER STATES" with the diagnosis even if it appears under a diagnosis header',
  ARRAY['extraction'],
  ARRAY['repair_order'],
  true,
  15,
  'axe-manual'
)
ON CONFLICT DO NOTHING;


-- ── Rule 3: Vehicle Registration — VIN extraction ─────────────────────────────
-- Vehicle registrations often have VIN in multiple locations; use the most reliable one
INSERT INTO core.ai_knowledge_base (
  category, title, content, applies_to, doc_types, is_active, sort_order, created_by
) VALUES (
  'extraction_rules',
  'Vehicle Registration: VIN location and format',
  'On California (and most state) vehicle registration documents:

VIN location hierarchy (use in order of reliability):
1. Field labeled "VIN", "VEHICLE ID NO", "VEHICLE IDENTIFICATION NUMBER", or "ID #"
2. Barcode/machine-readable section at bottom of document (if visible as text)
3. Description line that contains a 17-character alphanumeric string

VIN format rules:
- Always exactly 17 characters
- Valid characters: A-H, J-N, P-Z, 0-9 (no I, O, or Q)
- Extract WITHOUT spaces or dashes
- If you find a string that is 17 valid VIN characters, that is the VIN regardless of label

Also extract from vehicle registrations:
- year: 4-digit model year
- make: vehicle manufacturer
- model: vehicle model name
- license_plate: plate number (field labeled "LICENSE", "PLATE", or "LIC NO")
- registered_owner: owner name from registration',
  ARRAY['extraction'],
  ARRAY['vehicle_registration'],
  true,
  20,
  'axe-manual'
)
ON CONFLICT DO NOTHING;


-- ── Rule 4: VIN cross-reference — vehicle registration is canonical source ─────
-- When VIN appears on both RO and vehicle registration, the registration wins
INSERT INTO core.ai_knowledge_base (
  category, title, content, applies_to, doc_types, is_active, sort_order, created_by
) VALUES (
  'analysis_rules',
  'VIN canonical source: vehicle registration overrides repair order',
  'When analyzing a case that has both repair orders and a vehicle registration document:

VIN authority order (highest to lowest):
1. Vehicle Registration — most authoritative; issued by DMV with verified VIN
2. Purchase / Lease Agreement — second most reliable; dealer-recorded at time of sale
3. Repair Order — least reliable for VIN; sometimes auto-populated incorrectly by dealer DMS

Rules:
- If a vehicle registration exists and has a valid 17-char VIN, use that VIN as the canonical VIN for the case
- If a repair order VIN differs from the registration VIN, flag the discrepancy in attorney_notes
- A VIN mismatch between RO and registration is a potential data integrity issue worth noting
- If no registration exists, use the VIN from the purchase agreement, then RO as fallback',
  ARRAY['analysis'],
  ARRAY['repair_order', 'vehicle_registration'],
  true,
  25,
  'axe-manual'
)
ON CONFLICT DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- Verify all rules inserted correctly:
-- SELECT id, title, category, doc_types, sort_order, created_by, created_at
-- FROM core.ai_knowledge_base
-- ORDER BY sort_order, created_at;
-- ─────────────────────────────────────────────────────────────────────────────
