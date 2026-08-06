# snap-work-requirements fixture

Hand-authored (not vendored from any real Corticon project). A single coherent scenario — **SNAP ABAWD (Able-Bodied Adults Without Dependents) work requirement determination** — that exercises all 20 Corticon translation patterns from TRANSLATION-PATTERNS.md in one realistic project. Designed so Phase 3's classifier can be stress-tested against coexisting patterns, not just scattered single-pattern fixtures.

**This fixture has no real Corticon-computed output** — nobody has run it through Corticon, so there is no golden-master `.ert` for it. It validates classification/structure, not correctness of translated values.

## Scenario

Federal SNAP policy requires ABAWDs (ages 18–51) to work, train, or volunteer ≥ 80 hours/month or qualify for an exemption (disability, pregnancy, caretaker of child under 6). Counties with an active FNS ABAWD waiver are exempt from the requirement entirely.

The single goal node is `ApplicationMember.meetsWorkRequirement` (Boolean). All other derived facts feed into that determination.

**Three simplifications for pattern coverage** (not real SNAP policy):
- `bonusHours` / `absenceDeduction` on `ApplicationMember` don't map to real SNAP concepts — they exist solely to create a multi-operator expression (`operator-precedence` pattern)
- Training hours weighted at 75% (`enum-branch-b.ers`) is fictional — SNAP treats all qualifying activity types equally
- The iterative convergence loop (`iterative-seed` + `iterative-body`) is a sound pattern but real implementations would sum activities in a single pass

## Pattern coverage

| # | Pattern | File(s) |
|---|---|---|
| 1 | sequential-pipeline | Entire `top-level-flow.erf` (19 ordered steps) |
| 2 | iterative-convergence | `iterative-seed.ers` + `iterative-body.ers` in `iterative-loop.erf`; invoked with `iterative="true"` from step 10 |
| 3 | enum-switch-branching | `enum-branch.erf` — `BranchContainer` on `ApplicationMember.workActivityType` routing to `enum-branch-a.ers` (employment) or `enum-branch-b.ers` (training) |
| 4 | entity-creation | `entity-creation.ers` — `ApplicationMember.exemptions.new[exemptionType=...]` when `exemptionCategory <> null` |
| 5 | service-callout | `service-callout.erf` — `WaiverLookupServiceCallout.js` connector node |
| 6 | decision-table | `decision-table.ers` — three condition rows mapping disability/pregnancy/caretaker to `exemptionCategory` values |
| 7 | fact-assembly | `fact-assembly-a.ers` + `fact-assembly-b.ers` — both write `meetsWorkRequirement = true` under different conditions (exemption path vs. hours path) |
| 8 | conditional-branching | `conditional-branching.erf` — `BranchContainer` on `ApplicationMember.hasDisability = true`, chained targets `conditional-branch-a.ers` → `conditional-branch-b.ers` |
| 9 | null-default | `null-default.ers` — `hoursApplied = null → hoursApplied = hoursReported` |
| 10 | date-arithmetic | `date-arithmetic.ers` — `age = dob.yearsBetween(today)` |
| 11 | decimal-rounding | `decimal-rounding.ers` — `adjustedHours = adjustedHours.round(1)` |
| 12 | sort-ranking | `sort-ranking.ers` — `reviewTrack = activity->sortedBy(activityDate)->first.activityType` |
| 13 | collection-filter | `collection-filter.ers` — rulesheet-level filter `activity.isWithinReviewPeriod = true` gates all rules |
| 14 | explicit-override | `override-example.ers` — rule 1 (`meetsWorkRequirement = false`) `overriddenBy` rule 2; rule 2 (`meetsWorkRequirement = true`) `overrides` rule 1 when `household.abawaWaiverActive = true` |
| 15 | no-op | `decision-table.ers` rule 4 (condition `isInABAWDAge = false`, no action) and `collection-filter.ers` rule 1 (condition `hoursReported > 0`, no action) |
| 16 | unreachable-rulesheet | `unreachable-rulesheet.ers` — deprecated BBCE waiver logic, never wired into any ruleflow |
| 17 | operator-precedence | `operator-precedence.ers` — `adjustedHours = totalMonthlyHours + bonusHours * 1.0 - absenceDeduction` (multiplication before addition/subtraction) |
| 18 | logical-keywords | `logical-operators.ers` — `not`, `and` in `isAbawdCandidate = not isABAWDExempt and isInABAWDAge` |
| 19 | membership-test/range | `range-membership.ers` — `age in [18..51]`, `age in [0..17]`, `age in [52..150)` |
| 20 | type-conversion | `type-conversion.ers` — `summaryText = 'Age: ' + age.toString() + ', hours: ' + adjustedHours.toString()` |
