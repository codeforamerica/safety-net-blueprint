# Intake State Machine

Domain: `intake` | API spec: [intake-openapi.yaml](../../../contracts/intake-openapi.yaml) | State machine: [intake-state-machine.yaml](../../../contracts/intake-state-machine.yaml)

---

## Application

### Actions

- **submit** — Formally submits a draft application, starting the regulatory processing clock.
  - Transition: `draft` → `submitted`
  - Record the submission timestamp (regulatory clock start). (sets `submittedAt`)
  - Emit: `caintake.application.submitted` — Triggers eligibility screening, caseworker task creation, and confirmation notice.
- **open** — Moves a submitted application into active caseworker review.
  - Transition: `submitted` → `under_review`
  - Record when caseworker began review, marking the start of active processing. (sets `openedAt`)
- **close** — Closes the application once intake processing is complete.
  - Transition: `under_review` → `closed`
  - Emit: `caintake.application.closed`
- **withdraw** — Withdraws the application at the household's request.
  - Transition: `draft`/`submitted`/`under_review` → `withdrawn`
  - Emit: `caintake.application.withdrawn`
