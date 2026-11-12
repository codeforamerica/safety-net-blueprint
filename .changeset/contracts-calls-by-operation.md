---
"@codeforamerica/blueprint-safety-net-contracts": minor
---

**Breaking:** Before, eligibility's service calls for a Medicaid decision carried `decisionId` and `applicationId` as top-level fields and asked for an `fdsh_medicare_vci` service data-exchange doesn't offer. Now they name the member as `requestingResourceId`, carry those ids in `metadata.eligibility`, and ask for `fdsh_medicare` and `fdsh_vci` separately; eligibility also gains `createDecision`, for the system only, so `eligibility.decision.created` is generated. (#520)
