# Intake State Machine

Domain: `intake` | API: [intake-openapi.yaml](../../../contracts/domains/intake/intake-openapi.yaml) | State machine: [intake-state-machine.yaml](../../../contracts/intake-state-machine.yaml)

---

## Application

### Actions

- **submit** — Formally submits a draft application, starting the regulatory processing clock.
  - Transition: `draft` → `submitted`
  - Record the submission timestamp (regulatory clock start). (sets `submittedAt`)
  - Emit: `intake.application.submitted` — Triggers eligibility screening, caseworker task creation, and confirmation notice.
    - Subscribed by: [Eligibility/Determination](eligibility.md)
  - requestTimer
- **open** — Moves a submitted application into active caseworker review.
  - Transition: `submitted` → `under_review`
  - Record when caseworker began review, marking the start of active processing. (sets `openedAt`)
- **close** — Closes the application once intake processing is complete.
  - Transition: `under_review` → `closed`
  - Emit: `intake.application.closed`
- **withdraw** — Withdraws the application at the household's request.
  - Actors: applicant, or case_worker
  - Transition: `draft`/`submitted`/`under_review` → `withdrawn`
  - Emit: `intake.application.withdrawn`

### Event subscriptions

- **`intake.review_reminder`**
  - Emits `intake.application.review-reminder` — Notify supervisors that this application needs immediate attention.

---

## Interview

### Actions

- **start** — Starts the interview and puts its flags to the worker.
  - Transition: `scheduled` → `in_progress`
  - sets `startedAt`
  - Emit: `intake.interview.started`
  - suggestFlags
- **process-suggestions** — Evaluates the flags again, proposing a suggestion for a newly flagged record and expiring one whose flag cleared — called when the household's incomes change.
  - Transition: `in_progress` → `in_progress`
  - suggestFlags
- **complete** — Finishes the interview and expires its suggestions still open.
  - Transition: `in_progress` → `completed`
  - sets `completedAt`
  - Emit: `intake.interview.completed`
  - expireOpenSuggestions

### Event subscriptions

- **`intake.application_income.created`**
  - Look up: income (from `event.subject`)
  - processInterviewSuggestions
- **`intake.application_income.updated`**
  - Look up: income (from `event.subject`)
  - processInterviewSuggestions
