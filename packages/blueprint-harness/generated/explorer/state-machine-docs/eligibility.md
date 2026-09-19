# Eligibility State Machine

Domain: `eligibility` | API spec: [eligibility-openapi.yaml](../../../contracts/eligibility-openapi.yaml) | State machine: [eligibility-state-machine.yaml](../../../contracts/eligibility-state-machine.yaml)

---

## Determination

### Event subscriptions

- **`ca.intake.application.submitted`**
  - Create a pending determination for the submitted application.
  - Emits `ca.eligibility.determination.complete` — Signals that eligibility results are ready for caseworker review.
