-- core.case_intake: intake form data from HubSpot
CREATE TABLE IF NOT EXISTS core.case_intake (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES core.cases(id) ON DELETE CASCADE,

  -- Submission
  ela_intake TEXT,
  intake_management TEXT,
  intake_hubspot_qualifier TEXT,
  intake_associate TEXT,
  had_repairs BOOLEAN,
  paid_for_repairs TEXT,
  repair_count TEXT,

  -- Vehicle supplement
  purchase_or_lease TEXT,
  how_purchased TEXT,
  vehicle_status TEXT,

  -- Problems
  problem_1_category TEXT,
  problem_1_notes TEXT,
  problem_1_repair_attempts TEXT,
  problem_2_category TEXT,
  problem_2_notes TEXT,
  problem_2_repair_attempts TEXT,
  problem_3_category TEXT,
  problem_3_notes TEXT,
  problem_3_repair_attempts TEXT,
  problem_4_category TEXT,
  problem_4_notes TEXT,
  problem_4_repair_attempts TEXT,
  repair_attempts TEXT,
  last_repair_attempt_date DATE,

  -- Additional
  in_shop_30_days TEXT,
  contacted_manufacturer TEXT,
  manufacturer_offer TEXT,
  has_repair_documents TEXT,
  refund_preference TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT case_intake_case_id_unique UNIQUE (case_id)
);

CREATE INDEX IF NOT EXISTS idx_case_intake_case_id ON core.case_intake(case_id);

GRANT ALL ON core.case_intake TO service_role;
GRANT SELECT ON core.case_intake TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
