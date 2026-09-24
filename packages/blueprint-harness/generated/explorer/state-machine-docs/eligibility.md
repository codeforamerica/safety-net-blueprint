# Eligibility State Machine

Domain: `eligibility` | API spec: [eligibility-openapi.yaml](../../../contracts/eligibility-openapi.yaml) | State machine: [eligibility-state-machine.yaml](../../../contracts/eligibility-state-machine.yaml)

---

## Determination

### Actions

- **complete** — Marks the determination as complete once all program results are resolved.
  - Transition: `pending` → `completed`
  - Emit: `ca.eligibility.determination.complete` — Signals that all program eligibility results are ready for caseworker review.

### Event subscriptions

- **`ca.intake.application.submitted`**
  - Create a pending determination for the submitted application.
