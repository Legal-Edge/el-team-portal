#!/bin/bash
# Batch sync SharePoint files + run Gemini extraction for all attorney review cases
# Usage: ./scripts/batch-sync-extract-atty-review.sh
# Runs sync then bulk-extract per case, 3 cases in parallel

BASE_URL="https://team.easylemon.com"
TOKEN="b4d977d15d43a270204901b275dfaf8454373652aad4f1dcf80b8dc117218af8"

DEAL_IDS=(
  43599832688 45520055945 52838629769 54426374808 55475385704
  56004362112 56604302970 56896619373 56952535637 57046512158
  57135698949 57222781742 57372582290 57567651114 57575463498
  57629063260 57857604754 57886385707 57895554984 57896196501
  57946857587 57981729969 58025411658 58065163796 58098489757
  58133750325 58150118034 58140077604 58163808077 58168838478
  58182947894 58177539080 58157087671 58157866519 58163934517
  58170310302 58157721160 58166908452 58205435696
)

process_case() {
  local deal_id=$1
  local idx=$2
  local total=${#DEAL_IDS[@]}

  echo "[$idx/$total] Deal $deal_id — syncing SharePoint..."
  sync_result=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/admin/sharepoint/sync-case" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"hubspot_deal_id\": \"$deal_id\"}" \
    --max-time 60)

  if [ "$sync_result" = "200" ]; then
    echo "[$idx/$total] Deal $deal_id — sync OK, running extraction..."
  else
    echo "[$idx/$total] Deal $deal_id — sync returned $sync_result, still attempting extraction..."
  fi

  extract_result=$(curl -s -X POST "$BASE_URL/api/cases/$deal_id/documents/bulk-extract" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    --max-time 300 \
    2>/dev/null)

  extracted=$(echo "$extract_result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"extracted={d.get('extracted',0)} skipped={d.get('skipped',0)} errors={d.get('errors',0)}\")" 2>/dev/null || echo "parse_error")
  echo "[$idx/$total] Deal $deal_id — $extracted"
}

export -f process_case
export BASE_URL TOKEN

echo "Starting batch sync + extraction for ${#DEAL_IDS[@]} attorney review cases"
echo "Concurrency: 3 cases in parallel"
echo "================================================"

idx=0
for deal_id in "${DEAL_IDS[@]}"; do
  idx=$((idx + 1))
  # Run 3 in parallel
  process_case "$deal_id" "$idx" &
  if (( idx % 3 == 0 )); then
    wait
    sleep 2  # brief pause between batches
  fi
done
wait

echo "================================================"
echo "Batch complete."
