# Eligibility State Machine

Domain: `eligibility` | API spec: [eligibility-openapi.yaml](../../../contracts/eligibility-openapi.yaml) | State machine: [eligibility-state-machine.yaml](../../../contracts/eligibility-state-machine.yaml)

---

## Determination

### Transitions

- **flag-expedited** — System flags a Determination as qualifying for expedited SNAP processing
  - Actors: system only
  - Transition: no state change
  - Record that the household qualifies for expedited SNAP processing (sets `expeditedFlagged`)
  - Emit: `eligibility.determination.expedited` — Intake stores the flag; Workflow switches the intake task to the expedited SLA track (7 CFR § 273.2(i))
- **complete** — System marks a Determination as complete after all program Decisions are resolved
  - Actors: system only
  - Transition: `in_progress` → `completed`
  - Record when all Decisions were resolved (sets `completedAt`)
  - Emit: `eligibility.determination.determination_completed` — signals all program Decisions are resolved; Intake subscribes to close the application
- **withdraw** — System withdraws a Determination when the associated application is withdrawn
  - Actors: system only
  - Transition: `in_progress` → `withdrawn`
  - Record when the withdrawal occurred; already-resolved Decisions are preserved as the audit record (sets `withdrawnAt`)
  - Emit: `eligibility.determination.withdrawn`

### Event subscriptions

- **`intake.application.submitted`** *(emitted by [Intake/Application](intake.md#application))*
  - `POST eligibility/determinations`
- **`eligibility.determination.created`**
  - Create one Decision per program when a Determination is created
- **`intake.application.review_completed`** *(emitted by [Intake/Application](intake.md#application))*
  - Look up: determination
  - Call the final determination adapter for each remaining pending Decision (42 CFR § 435.912)
- **`eligibility.application.decision_completed`**
  - Look up: pendingDecision
  - If `$pendingDecision is null`:
    - `POST eligibility/determinations/$this.data.determinationId/complete`
- **`intake.application.withdrawn`** *(emitted by [Intake/Application](intake.md#application))*
  - Look up: determination
  - If `id is set`:
    - `POST eligibility/determinations/$determination.id/withdraw`

---

## Decision

### Transitions

- **approve** — System approves a Decision after automatic or caseworker review
  - Actors: system only
  - Transition: `pending` → `approved`
  - Record when the Decision was finalized (sets `decidedAt`)
  - Record whether the Decision was reached automatically or by a caseworker (sets `path`)
  - Emit: `eligibility.decision.decision_completed` — Intake records the outcome per member; Determination checks if all Decisions are resolved
- **deny** — System denies a Decision based on failing eligibility criteria
  - Actors: system only
  - Transition: `pending` → `denied`
  - sets `decidedAt`
  - sets `path`
  - Store the machine-readable denial reason; required for the Notice of Action and appeal basis (7 CFR § 273.2(h), 42 CFR § 435.917) (sets `denialReasonCode`)
  - Emit: `eligibility.decision.decision_completed`
- **mark-ineligible** — System marks a Decision as categorically ineligible
  - Actors: system only
  - Transition: `pending` → `ineligible`
  - sets `decidedAt`
  - sets `path`
  - Store the categorical ineligibility reason code (e.g., citizenship bar for SNAP, age limit for TANF) (sets `denialReasonCode`)
  - Emit: `eligibility.decision.decision_completed`

### Event subscriptions

- **`eligibility.decision.created`**
  - Match on `$object.program`:
    - When `snap`:
      - Call the SNAP expedited screening adapter; if criteria are met, the adapter triggers flag-expedited on the Determination (7 CFR § 273.2(i))
    - When `medicaid`:
      - Initiate async data exchange for Medicaid ex parte — MAGI income check (FDSH FTI) and existing enrollment check (FDSH Medicare/VCI) (42 CFR § 435.940, 42 CFR § 435.916)
- **`data_exchange.call.completed`**
  - Call the Medicaid ex parte adapter when all data exchange results for a Decision are in; adapter triggers approve, deny, or mark-ineligible (42 CFR § 435.911)
