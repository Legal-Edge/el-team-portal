-- doc-v5: AI Knowledge Base
-- Editable rules injected into Haiku extraction + Sonnet analysis prompts

CREATE TABLE IF NOT EXISTS core.ai_knowledge_base (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  category    TEXT        NOT NULL,
  title       TEXT        NOT NULL,
  content     TEXT        NOT NULL,
  applies_to  TEXT[]      NOT NULL DEFAULT ARRAY['extraction', 'analysis'],
  doc_types   TEXT[]      DEFAULT NULL,   -- null = all doc types; ['repair_order'] = RO only
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_knowledge_category
  ON core.ai_knowledge_base (category, is_active, sort_order);

-- ── Seed: initial knowledge base ──────────────────────────────────────────

INSERT INTO core.ai_knowledge_base (category, title, content, applies_to, doc_types, sort_order) VALUES

-- ── Repair Order: Date Fields ─────────────────────────────────────────────
('extraction_rules', 'Ford/Dealer RO — Date Field Disambiguation',
$$Ford and many dealer repair orders have MULTIPLE date fields in the header row that look similar. Rules for identifying the correct dates:

CORRECT fields to use:
- "DATE/TIME IN" or "DATE IN" = repair_date_in (when customer brought car in for service)
- "DATE OUT" adjacent to "DATE/TIME IN" = repair_date_out (when car was returned after service)

WRONG fields — do NOT use for repair dates:
- "PROD. DATE" = vehicle manufacture/production date — IGNORE for repair dates
- "IN-SERV DATE" or "IN SERVICE DATE" = when vehicle was first put in service (purchase year) — IGNORE
- "DELIV. DATE" or "DELIVERY DATE" = when vehicle was originally delivered to customer — IGNORE for repair dates
- "CUST. LABOR RATE DATE" = pricing date — IGNORE

If DATE/TIME IN shows "03/04/26 08:48", the repair_date_in is 2026-03-04 (YY format = 20YY).
Days in shop = repair_date_out minus repair_date_in (never use delivery or production dates for this calculation).$$,
ARRAY['extraction'], ARRAY['repair_order'], 10),

('extraction_rules', 'Date Format: YY vs YYYY',
$$Dealer repair orders often use 2-digit year format (YY):
- "03/04/26" = March 4, 2026 (not 1926 or 2022)
- "01/17/22" = January 17, 2022
- Always interpret 2-digit years as 20YY for dates after 2000
- Output all dates as YYYY-MM-DD format$$,
ARRAY['extraction'], ARRAY['repair_order'], 20),

('extraction_rules', 'Days In Shop Calculation',
$$Calculate days_in_shop as: repair_date_out minus repair_date_in.
Example: date_in = 2026-03-04, date_out = 2026-03-11 → days_in_shop = 7
NEVER use the delivery date, production date, or any other header dates in this calculation.
If repair_date_out is missing or unclear, set days_in_shop to null.$$,
ARRAY['extraction'], ARRAY['repair_order'], 30),

-- ── Repair Order: Status Codes ────────────────────────────────────────────
('repair_codes', 'Unable to Duplicate / No Fault Found',
$$Common dealer phrases meaning the complaint could NOT be reproduced — set repair_status = "unable_to_duplicate":
- "UTD" or "U.T.D." = Unable to Duplicate
- "NFF" = No Fault Found
- "CNDNC" or "CANNOT DUPLICATE NO CODES"
- "NO CODES FOUND" + no repair performed
- "ROAD TEST — NORMAL OPERATION"
- "CUSTOMER STATES — UNABLE TO VERIFY AT THIS TIME"
This status is critical for lemon law — "unable to duplicate" attempts still count as repair attempts.$$,
ARRAY['extraction', 'analysis'], ARRAY['repair_order'], 40),

('repair_codes', 'Warranty vs Customer Pay',
$$A repair is warranty_repair = true when ANY of:
- Type column shows "Warranty" or "W" or "WAR"
- Amount/price for labor line shows "$0.00" or "No Charge"
- Line type is "Warranty Claim Type: F" or similar
- Authorization code is present (manufacturer authorization = warranty)
Customer pay = warranty_repair = false (customer paid out of pocket).$$,
ARRAY['extraction'], ARRAY['repair_order'], 50),

('repair_codes', 'Partial Complete / Work In Progress Status',
$$"PARTIAL-COMPLETE", "PARTIAL COMPLETE", or "PC" in STATUS field means:
- repair_status = "parts_on_order" (waiting for parts)
- Vehicle may still be at dealership
- Days in shop may be ongoing — note this in extraction$$,
ARRAY['extraction'], ARRAY['repair_order'], 60),

-- ── Lemon Law Analysis Rules ──────────────────────────────────────────────
('analysis_rules', 'Same Defect Grouping',
$$When counting repair attempts for "same defect":
- Group by SYMPTOM, not by diagnostic code (different DTC codes can be the same symptom)
- "Rattle when on 4x4" and "4x4 making noise" = SAME defect
- "Engine stall" and "vehicle shuts off while driving" = SAME defect
- "Check engine light" alone is NOT a defect — look at the underlying fault
- "Electrical fault" with different codes may be the same defect if same system
- Successful repair followed by same complaint returning = new attempt on same defect$$,
ARRAY['analysis'], NULL, 70),

('analysis_rules', 'Days Out of Service Counting',
$$Count ALL days vehicle was at the dealership for warranty repairs:
- Sum days_in_shop across ALL repair orders for warranty repairs
- Include "parts on order" days (vehicle still at dealer)
- Do NOT include days customer had the car between repairs
- If repair_date_out is missing, estimate conservatively$$,
ARRAY['analysis'], NULL, 80),

('analysis_rules', 'Unable to Duplicate Attempts Count',
$$"Unable to Duplicate" visits STILL COUNT as repair attempts under lemon law.
California Song-Beverly: each visit for the same defect = 1 attempt regardless of outcome.
Flag clearly when complaint recurs after an "unable to duplicate" visit — this pattern strengthens the case.$$,
ARRAY['analysis'], NULL, 90),

-- ── Document Identification ───────────────────────────────────────────────
('document_patterns', 'Repair Order Identification',
$$A document is a repair_order if it contains:
- "Repair Order", "RO", "Work Order" in header
- Fields like: Op-Code, Tech, Labor Hours, Concern/Cause/Correction
- Dealer name + vehicle description + VIN
- RO Number / Invoice Number
Common layouts: Ford/Lincoln, GM/Chevrolet/GMC, BMW, Toyota/Lexus, Honda/Acura dealers all use similar 3-section format (A, B, C lines with Concern/Cause/Correction).$$,
ARRAY['extraction'], ARRAY['repair_order'], 100);
