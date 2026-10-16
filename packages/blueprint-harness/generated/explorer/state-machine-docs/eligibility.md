# Eligibility State Machine

Domain: `eligibility` | API: [eligibility-openapi.yaml](../../../contracts/domains/eligibility/eligibility-openapi.yaml) | State machine: [eligibility-state-machine.yaml](../../../contracts/eligibility-state-machine.yaml)

---

## Determination

### Actions

- **complete** — Marks the determination as complete once all program results are resolved.
  - Transition: `pending` → `completed`
  - Emit: `eligibility.determination.complete` — Signals that all program eligibility results are ready for caseworker review.

### Event subscriptions

- **`intake.application.submitted`**
  - Create a pending determination for the submitted application.
