---
"@codeforamerica/blueprint-safety-net-contracts": minor
---

Before, the contracts had no rules for Medicaid's work requirements. Now the eligibility domain's `medicaidWorkRequirements` ruleset decides whether the 2027 community engagement requirement applies, whether a person is exempt, whether enough review months count, and what comes next, at `POST /eligibility/determinations/evaluate-medicaid-work-requirements`. `eligibility-annotations-source.yaml` records each way it differs from the draft rules it was ported from, and why. (#496)
