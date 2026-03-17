# Attorney Decision Analysis
*3,294 cases analyzed | March 2026*

---

## Overall Decision Distribution

| Decision | Count | % |
|----------|-------|---|
| Retain | 1,990 | 60.4% |
| Nurture | 860 | 26.1% |
| Drop | 342 | 10.4% |
| Clarification Needed | 102 | 3.1% |

---

## Aaron Waldo vs. Liam Jones — Key Divergence

| Metric | Aaron Waldo | Liam Jones |
|--------|-------------|------------|
| Cases reviewed | 1,398 | 1,896 |
| Retain rate | **72%** | **52%** |
| Nurture rate | 16% | 33% |
| Drop rate | 11% | 10% |
| Clarification needed | 1% | 4% |
| Avg mileage retained | 22,765 | 21,052 |
| Avg mileage dropped | 41,280 | 44,102 |

**Aaron is 20 points more aggressive at retaining.** Liam sends 2× more cases to nurture.

### Liam's Trend Over Time (⚠️ Flagged)
| Period | n | Retain | Nurture | Drop |
|--------|---|--------|---------|------|
| Earliest | 632 | 55% | 33% | 9% |
| Middle | 632 | 55% | 33% | 9% |
| Most Recent | 632 | **47%** | 34% | 12% |

**Counter to expectation — Liam's retain rate is DECLINING, not increasing.** Most recent period is his lowest (47%). Worth discussing with him directly.

Aaron's pattern is stable across all periods (71% → 70% → 73%).

---

## Cause of Action (Retained Cases)

| Cause | Aaron | Liam |
|-------|-------|------|
| State + Federal (both) | 56% | 65% |
| Federal only (Mag-Moss) | 43% | 34% |

Liam skews toward citing both tracks. Aaron uses Mag-Moss only more often — likely for cases where the state window has closed but federal still applies.

---

## Mileage as Predictor

Strong linear relationship — higher mileage = higher drop rate:

| Mileage | n | Retain | Drop |
|---------|---|--------|------|
| 0–15K | 1,407 | 64% | 4% |
| 15–30K | 818 | 62% | 6% |
| 30–50K | 679 | 56% | 16% |
| 50–80K | 308 | 51% | 33% |
| 80K+ | 50 | 34% | 56% |

**Key threshold: ~40,000 miles.** Below = strong candidate. Above 50K = high drop risk.

---

## State Retain Rates (Top)

| State | Total | Retain Rate |
|-------|-------|-------------|
| Oklahoma | 25 | 88% |
| Washington | 67 | 84% |
| Utah | 39 | 82% |
| Oregon | 50 | 78% |
| Colorado | 59 | 76% |
| Virginia | 72 | 74% |
| Arizona | 102 | 72% |
| Texas | 359 | 69% |
| Florida | 903 | 63% |
| New Jersey | ~high volume | ~60% |

Florida and Texas dominate volume. Western states have higher retain rates — likely because lemon laws in WA, CO, OR are more favorable.

---

## Manufacturer Retain Rates

| Manufacturer | Total | Retain Rate |
|---|---|---|
| FCA (Jeep/Chrysler/Dodge/Ram) | 770 | **70%** |
| General Motors | 839 | **68%** |
| Mazda | 51 | 61% |
| Hyundai | 275 | 60% |
| Ford | 219 | 60% |
| Volkswagen | 207 | 57% |
| Kia | 146 | 56% |
| JLR | 55 | 55% |
| Honda | 120 | 52% |
| Nissan | 114 | 49% |
| Toyota | 130 | 38% |
| Mercedes-Benz | 115 | 37% |
| BMW | 61 | 36% |
| Tesla | 73 | **34%** |

FCA and GM are highest — likely most repair attempts per case. Tesla/BMW/Mercedes lowest — settlement posture and warranty structures differ.

---

## Why Cases Get NURTURED (Liam's Notes — Key Patterns)

1. **Not enough duplicated repairs** — single occurrence of defect, needs to recur
2. **Repairs outside warranty window** — valid repairs but too old or too many miles
3. **Not warranty-covered repairs** — customer paid out of pocket, oil changes, aftermarket
4. **Insufficient days OOS** — needs more cumulative time in shop
5. **Minor/cosmetic issues** — noise, rattles, trim — not substantial enough
6. **Manufacturer denied claim already** — BMW cases especially
7. **Single large OOS event, not duplicated** — e.g. 28 days once but defect didn't repeat
8. **Mix of unrelated issues** — no clear recurring defect pattern

---

## Why Cases Get DROPPED

**Aaron top drop keywords:** warranty, outside, passed, period, days, enough
**Liam top drop keywords:** past, warranty, claim, history, strong, covered

Common theme: **out of warranty window** + **not enough repair history** + **repairs not covered under warranty**

---

## Inconsistency Analysis

**133 buckets** where same state + manufacturer + new/used produced both Retain AND Drop decisions. This is expected (details matter) but flags where the AI needs to look deeper than surface variables.

Most inconsistencies are in high-volume combos (FL/GM, FL/FCA, TX/GM) where case-specific repair history matters more than the category.

---

## Proposed AI Decision Logic

### Decision Framework (based on historical patterns)

**Strong Retain signal:**
- Mileage < 30,000
- 2+ duplicated warranty repairs for same/related defect
- Any single repair visit > 10 days OOS, or cumulative > 20 days
- New vehicle
- Manufacturer: FCA, GM, Hyundai, Ford
- State with long window (CA, TX, FL, WA, AZ, CO)

**Nurture signal:**
- Only 1 repair visit with no duplication
- Mileage 30–50K (approaching warranty limits)
- Repairs not clearly warranty-covered
- Minor/cosmetic issues only (noise, trim)
- Needs more repair history to build case

**Drop signal:**
- Mileage > 50,000 (likely outside all windows)
- Repairs clearly outside warranty period
- Only paid repairs (no warranty coverage)
- No duplicated defect
- Manufacturer: Tesla, BMW, Mercedes (lower settle rate)

**Cause of Action logic:**
- Within state lemon law window (time + mileage) → cite both State + Federal
- Outside state window but under manufacturer warranty → Mag-Moss only
- Default: cite both tracks for maximum leverage

### Aaron vs Liam Profile Difference
Aaron applies a more aggressive retain threshold — he sees cases Liam nurtures as retainable. The unified model should lean toward Aaron's threshold (higher retain rate = more revenue) but flag borderline cases for human review.

---

## Recommended AI Output Format

```
DECISION: Retain | Nurture | Drop | Clarification Needed
CONFIDENCE: High | Medium | Low
CAUSE_OF_ACTION: State Lemon Law | Magnuson-Moss | Both

RETAIN SIGNALS:
- [list of factors supporting retain]

RISK FACTORS:
- [list of factors working against]

NURTURE_REASON: (if Nurture) What needs to change before this can be retained
DROP_REASON: (if Drop) Why this case doesn't meet thresholds

ATTORNEY_NOTES: Draft language the attorney can use as starting point
```

---

*⚠️ AI decisions are recommendations only. All retain/drop decisions must be confirmed by a licensed attorney.*
