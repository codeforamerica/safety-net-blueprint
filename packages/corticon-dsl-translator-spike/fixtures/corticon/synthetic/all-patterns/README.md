# all-patterns fixture

Original, hand-authored (not vendored from any real Corticon project — same approach as `branch-reconstruction/`).
A single coherent scenario ("Household Benefit Eligibility Processing") deliberately incorporating every pattern from
issue #388's classification table, so Phase 3's classifier can be stress-tested against coexisting patterns in one
project, not just scattered single-pattern real fixtures.

**This fixture has no real Corticon-computed output** — nobody has run it through Corticon, so there is no golden-master
`Test.ert` for it. It validates classification/structure, not correctness of translated values. See issue #388's Phase 3
entry for why this exists and why that distinction matters.

Each file is named for the pattern it exercises. Multi-file patterns share a suffix (`-a`/`-b`, `-seed`/`-body`).

| # | Pattern | File(s) |
|---|---|---|
| 1 | Sequential pipeline | `decimal-rounding.ers` → `decision-table.ers` (relationship between the two) |
| 2 | Iterative convergence | `iterative-seed.ers` + `iterative-body.ers` in `benefit-loop.erf` |
| 3 | Enum-switch branching | `program-eligibility-loop.erf` — `BranchContainer` on `Applicant.programTrack` routing to `override-example.ers` or `enum-branch-target.ers` |
| 4 | Entity creation | `entity-creation.ers` |
| 5 | Service call-out | `VerifyIncome` connector node in `top-level-flow.erf` |
| 6 | Decision table | `decision-table.ers` (multiple rows/columns) |
| 7 | Fact assembly | `fact-assembly-a.ers` + `fact-assembly-b.ers` (both write `Applicant.isEligible`) |
| 8 | Conditional branching with chained targets | `branch-chain-a.ers` + `branch-chain-b.ers` under `DisabilityBranch` in `top-level-flow.erf` |
| 9 | Null default | `null-default.ers` (`reportedAssets = null` → `0`) |
| 10 | Date/age arithmetic | `date-arithmetic.ers` (`dob.yearsBetween(today)`) |
| 11 | Decimal rounding | `decimal-rounding.ers` (`.round(2)`) |
| 12 | Sort and rank | `sort-ranking.ers` (`sortedBy`/`first`) |
| 13 | Collection filter | `collection-filter.ers` (filtered to adult household members) |
| 14 | Explicit override | `override-example.ers` — rule 1 (`isEligible = true`) `overrides` rule 0 (the unconditional `isProgramAEligible = false` fallback), same real `overrides`/`overriddenBy` attribute shape confirmed in `fixtures/corticon/vendor-samples/irr/evaluate npv.ers` |
