# State Machine Overview

Auto-generated from `packages/contracts/*-state-machine.yaml`.

See also: [Published events](events.md)

---

| Machine | States |
|---|---|
| [Eligibility — Determination](eligibility.md#determination) | `in_progress`, `completed`, `withdrawn` |
| [Eligibility — Decision](eligibility.md#decision) | `pending`, `approved`, `denied`, `ineligible` |
| [Intake — Application](intake.md#application) | `draft`, `submitted`, `under_review`, `withdrawn`, `closed` |
| [Intake — Verification](intake.md#verification) | `pending`, `inconclusive`, `satisfied`, `waived`, `cannot_verify` |
| [Workflow — Task](workflow.md) | `pending`, `in_progress`, `completed`, `escalated`, `cancelled`, `awaiting_client`, `awaiting_verification`, `pending_review` |
