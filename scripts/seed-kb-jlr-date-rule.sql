-- KB Rule: Jaguar/Land Rover RO date format
-- Run in Supabase SQL editor

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
