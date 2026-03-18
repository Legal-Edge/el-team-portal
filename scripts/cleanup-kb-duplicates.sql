-- ─────────────────────────────────────────────────────────────────────────────
-- KB Deduplication Cleanup
-- Run in Supabase SQL editor
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: For exact title duplicates — delete all but the latest (highest created_at)
DELETE FROM core.ai_knowledge_base
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY title ORDER BY created_at DESC) AS rn
    FROM core.ai_knowledge_base
  ) ranked
  WHERE rn > 1
);

-- Step 2: Delete weaker synonym versions (same concept, different title)
-- Keep: 'Ford/Dealer RO — Date Field Disambiguation' (has em-dash, most complete)
DELETE FROM core.ai_knowledge_base
WHERE title IN (
  'Ford/Dealer RO - Date Field Disambiguation',
  'RO Date Fields - Use DATE/TIME IN not DELIV DATE'
);

-- Keep: 'Date Format: YY vs YYYY'
DELETE FROM core.ai_knowledge_base
WHERE title IN (
  'Date Format YY vs YYYY',
  'Date Format - 2-digit year means 20YY'
);

-- Keep: 'FCA/Stellantis ROs: "CUSTOMER STATES:" lines are always the Complaint'
DELETE FROM core.ai_knowledge_base
WHERE title = 'CUSTOMER STATES lines are always complaint — never diagnosis';

-- Keep: 'Unable to Duplicate / No Fault Found'
DELETE FROM core.ai_knowledge_base
WHERE title = 'Unable to Duplicate - UTD NFF';

-- Keep: 'Same Defect Grouping'
DELETE FROM core.ai_knowledge_base
WHERE title = 'Same Defect - Group by Symptom not Code';

-- Keep: 'Vehicle Registration: VIN location and format'
DELETE FROM core.ai_knowledge_base
WHERE title = 'Vehicle registration — always extract VIN';

-- Delete test rule
DELETE FROM core.ai_knowledge_base
WHERE title = 'Test Rule';

-- Step 3: Verify — should be one clean row per concept
SELECT id, title, category, doc_types, sort_order, created_by, created_at
FROM core.ai_knowledge_base
ORDER BY sort_order, created_at;
