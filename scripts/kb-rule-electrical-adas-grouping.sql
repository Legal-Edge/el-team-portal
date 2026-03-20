-- KB Rule: Electrical/ADAS system complaints = same underlying defect
-- Addresses: screen blackouts + collision warning lights being split into separate defect categories
-- Impact: Prevents AI from under-counting repair attempts on modern vehicles with integrated electronics

INSERT INTO core.ai_knowledge_base (
  category, title, content, applies_to, doc_types, is_active, sort_order, created_by
) VALUES (
  'analysis_rules',
  'Electrical + ADAS/Safety System complaints = same underlying defect',
  'Modern vehicles integrate infotainment, displays, cameras, and ADAS (Advanced Driver Assistance Systems) into a single electronic architecture. Complaints that appear different are often manifestations of the same underlying electrical system failure.

TREAT AS THE SAME DEFECT CATEGORY:
- Screen blackouts / display issues / infotainment failures
- Collision warning lights / forward collision alert / automatic emergency brake warnings
- Lane departure warnings / lane keeping assist errors
- Blind spot monitoring failures
- Backup camera malfunctions / parking sensor failures
- Driver assistance system warnings ("check driver assistance system")
- Adaptive cruise control errors
- Any combination of warning lights related to electronic/ADAS systems

EXAMPLES OF SAME DEFECT:
- RO 1: "Screen went black" + RO 2: "Collision warning light on" = SAME electrical system defect (2 attempts)
- RO 1: "Navigation not working" + RO 2: "Lane departure warning error" = SAME electrical system defect (2 attempts)
- RO 1: "Backup camera blank" + RO 2: "Blind spot monitor malfunction" + RO 3: "Forward collision alert on" = SAME defect (3 attempts)

ATTORNEY NOTES GUIDANCE:
- When you see complaints spanning infotainment + ADAS + warning lights, flag in attorney_notes: "Multiple complaints appear to stem from the same integrated electronic/ADAS system — [list complaints] — treat as recurring defect across [N] repair visits"
- This matters most in states requiring same-defect recurrence (FL, CA, TX, etc.)
- Under Magnuson-Moss, the integrated electronics system failing repeatedly is a clear warranty breach

DO NOT group with:
- Purely mechanical brake failures (ABS hydraulic, brake pad wear) — separate category
- Purely mechanical steering (rack and pinion wear) — separate category
- Engine mechanical failures — separate category',
  ARRAY['analysis'],
  NULL,
  true,
  30,
  'axe-manual'
)
ON CONFLICT DO NOTHING;

-- Verify:
-- SELECT id, title, sort_order FROM core.ai_knowledge_base WHERE sort_order = 30;
