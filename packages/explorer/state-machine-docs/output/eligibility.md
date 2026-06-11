# Eligibility State Machine

Domain: `eligibility` | API spec: [eligibility-openapi.yaml](../../../contracts/eligibility-openapi.yaml) | State machine: [eligibility-state-machine.yaml](../../../contracts/eligibility-state-machine.yaml)

---

## Determination

### Actions

- **flag-expedited** — System flags a Determination as qualifying for expedited SNAP processing
  - Actors: system only
  - Transition: no state change
  - Record that the household qualifies for expedited SNAP processing (sets `expeditedFlagged`)
  - Emit: `eligibility.determination.undefined` — Intake stores the flag; Workflow switches the intake task to the expedited SLA track (7 CFR § 273.2(i))
- **complete** — System marks a Determination as complete after all program Decisions are resolved
  - Actors: system only
  - Transition: `in_progress` → `completed`
  - Record when all Decisions were resolved (sets `completedAt`)
  - Emit: `eligibility.determination.undefined` — signals all program Decisions are resolved; Intake subscribes to close the application
- **evaluate** — Run eligibility determination for all pending Decisions; trial runs project outcomes without changing Decision state or emitting decision_completed events
  - Actors: system, or case_worker
  - Transition: no state change
  - Refresh the EligibilitySnapshot, then call the determination adapter for each remaining pending Decision (42 CFR § 435.912). Official runs allow the adapter to approve, deny, or mark-ineligible each Decision; trial runs return projected outcomes without changing Decision state or emitting decision_completed events. Correlation IDs (decisionId, determinationId) are passed in metadata so the adapter can echo them back for response correlation. For household programs (snap), the platform flattens per-member verificationSummary arrays and adds memberId to each entry before sending — exact assembly rules are specified in issue #353.
- **withdraw** — System withdraws a Determination when the associated application is withdrawn
  - Actors: system only
  - Transition: `in_progress` → `withdrawn`
  - Record when the withdrawal occurred; already-resolved Decisions are preserved as the audit record (sets `withdrawnAt`)
  - Emit: `eligibility.determination.undefined`

### Event subscriptions

- **`undefined`**
  - Create a Determination for the submitted application
  - Seed one pending Decision per household member per applied-for program for a Determination
  - If `"snap" in $this.data.programs`:
    - Call the SNAP expedited screening adapter; if criteria are met, the adapter triggers flag-expedited on the Determination (7 CFR § 273.2(i))
- **`undefined`**
  - Look up: application (from `event.subject`), determination
  - If `$application.status is not "draft" and $application.status is not "withdrawn" and $application.status is not "closed"`:
    - For each `$this.data.programs`:
- **`undefined`**
  - Look up: determination
  - Refresh the EligibilitySnapshot, then call the determination adapter for each remaining pending Decision (42 CFR § 435.912). Official runs allow the adapter to approve, deny, or mark-ineligible each Decision; trial runs return projected outcomes without changing Decision state or emitting decision_completed events. Correlation IDs (decisionId, determinationId) are passed in metadata so the adapter can echo them back for response correlation. For household programs (snap), the platform flattens per-member verificationSummary arrays and adds memberId to each entry before sending — exact assembly rules are specified in issue #353.
- **`undefined`**
  - Look up: pendingDecision
  - If `$pendingDecision is null`:
    - Complete the Determination when all program Decisions are resolved
- **`undefined`**
  - Look up: determination
  - If `id is set`:
    - Withdraw the Determination; already-resolved Decisions are preserved as the audit record

---

## Decision

### Actions

- **approve** — System approves a Decision after automatic or caseworker review
  - Actors: system only
  - Transition: `pending` → `approved`
  - Record when the Decision was finalized (sets `decidedAt`)
  - Record whether the Decision was reached automatically or by a caseworker (sets `path`)
  - Emit: `eligibility.decision.undefined` — Intake records the outcome per member; Determination checks if all Decisions are resolved
- **deny** — System denies a Decision based on failing eligibility criteria
  - Actors: system only
  - Transition: `pending` → `denied`
  - sets `decidedAt`
  - sets `path`
  - Store the machine-readable denial reason; required for the Notice of Action and appeal basis (7 CFR § 273.2(h), 42 CFR § 435.917) (sets `denialReasonCode`)
  - Emit: `eligibility.decision.undefined`
- **mark-ineligible** — System marks a Decision as categorically ineligible
  - Actors: system only
  - Transition: `pending` → `ineligible`
  - sets `decidedAt`
  - sets `path`
  - Store the categorical ineligibility reason code (e.g., citizenship bar for SNAP, age limit for TANF) (sets `denialReasonCode`)
  - Emit: `eligibility.decision.undefined`

### Event subscriptions

- **`undefined`**
  - If `program is "medicaid"`:
    - Initiate async data exchange for Medicaid ex parte — MAGI income check (FDSH FTI) and existing enrollment check (FDSH Medicare/VCI) (42 CFR § 435.940, 42 CFR § 435.916)
- **`undefined`**
  - Call the Medicaid ex parte adapter when all data exchange results for a Decision are in; adapter triggers approve, deny, or mark-ineligible (42 CFR § 435.911)
