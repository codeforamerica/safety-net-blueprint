---
"@codeforamerica/blueprint-safety-net-contracts": minor
---

Before, the contracts had no rules for SNAP's work requirements. Now the eligibility domain's `snapWorkRequirements` ruleset decides, for one person, whether the work rules apply, which exemptions hold, whether they're met and what proof is needed, at `POST /eligibility/determinations/evaluate-snap-work-requirements`, in the same vocabulary as `medicaidWorkRequirements`. `eligibility-annotations-source.yaml` records each way it differs from the self-advocacy tool it was translated from, and why. (#496)
