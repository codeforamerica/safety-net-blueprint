# all-patterns fixture

Original, hand-authored (not vendored from any real Corticon project — same approach as `branch-reconstruction/`).
A single coherent scenario ("Household Benefit Eligibility Processing") deliberately incorporating every pattern from
issue #388's classification table, so Phase 3's classifier can be stress-tested against coexisting patterns in one
project, not just scattered single-pattern real fixtures.

**This fixture has no real Corticon-computed output** — nobody has run it through Corticon, so there is no golden-master
`Test.ert` for it. It validates classification/structure, not correctness of translated values. See issue #388's Phase 3
entry for why this exists and why that distinction matters.

| # | Pattern | Where |
|---|---|---|
| 1 | Ordinary cross-rulesheet dependency | `ComputeIncome.ers` → `IncomeTier.ers` |
| 2 | Genuine cycle | `InitialBenefit.ers` + iterative `benefit-loop.erf` (`AdjustBenefit.ers`) |
| 3 | One-directional dependency dressed in iterative | Iterative `ActivityNode` invoking nested `program-eligibility-loop.erf` (an enum-switch `BranchContainer` on `Applicant.programTrack`) → `ProgramAEligibility.ers` → `ProgramBEligibility.ers` |
| 4 | Entity creation/association mutation | `CreateHouseholds.ers` |
| 5 | Service call-outs | `VerifyIncome` connectorList node in `top-level-flow.erf` |
| 6 | Decision-table combinatorics | `IncomeTier.ers` (multiple rows/columns) |
| 7 | Cross-rulesheet Fact assembly | `EligibilityPartA.ers` + `EligibilityPartB.ers` both write `Applicant.isEligible` |
| 8 | Conditional branching | Non-iterative `BranchContainer` on `Applicant.hasDisability`, single branch chaining `DisabilityBranchA.ers` → `DisabilityBranchB.ers` |
| 9 | Null-check masking | `AssetCheck.ers` (`reportedAssets = null` → `0`) |
| 10 | Date/age arithmetic | `AgeCalculation.ers` (`dob.yearsBetween(today)`) |
| 11 | Currency/decimal precision | `ComputeIncome.ers` (`.round(2)`) |
| 12 | Sorting/ranking | `ProgramRanking.ers` (`sortedBy`/`first`) |
| 13 | Filters | `AdultCount.ers` (filtered to adult household members) |
