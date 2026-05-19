# Intake State Machine

Domain: `intake` | API spec: [intake-openapi.yaml](../../../contracts/intake-openapi.yaml) | State machine: [intake-state-machine.yaml](../../../contracts/intake-state-machine.yaml)

---

## Application

### Transitions

- **submit** — Formally submits a draft application, starting the regulatory processing clock
  - Actors: applicant, or caseworker
  - Transition: `draft` → `submitted`
  - Record when the application was formally submitted (sets `submittedAt`)
  - Emit: `intake.application.submitted` — starts the regulatory clock; triggers caseworker task creation and confirmation notice
    - Subscribed by: [Intake/Application](intake.md#application), [Workflow/Task](workflow.md)
- **open** — System marks a submitted application as under active caseworker review
  - Actors: system only
  - Transition: `submitted` → `under_review`
  - Emit: `intake.application.opened` — signals caseworker has begun active review
- **complete-review** — Caseworker signals data collection is complete and the application is ready for determination
  - Actors: caseworker, or supervisor
  - Transition: no state change
  - Emit: `intake.application.review_completed` — signals data collection is complete; triggers eligibility determination
- **close** — Marks a reviewed application as closed after all determinations are complete
  - Actors: caseworker, supervisor, or system
  - Transition: `under_review` → `closed`
  - Record when the intake phase closed (sets `closedAt`)
  - Emit: `intake.application.closed` — signals intake is complete; triggers case creation
- **withdraw** — Applicant or caseworker withdraws the application before a decision is made
  - Actors: applicant, caseworker, or supervisor
  - Transition: `submitted`/`under_review` → `withdrawn`
  - Record when the application was withdrawn (sets `withdrawnAt`)
  - Emit: `intake.application.withdrawn` — triggers open task cancellation and withdrawal notice
- **flag-expedited** — Caseworker, supervisor, or system flags the application as qualifying for expedited processing
  - Actors: caseworker, supervisor, or system
  - Transition: no state change
  - Mark the application as qualifying for expedited processing (sets `isExpedited`)
  - Emit: `intake.application.expedited_flagged` — triggers workflow to escalate to expedited SLA track

### Event subscriptions

- **`workflow.task.claimed`** *(emitted by [Workflow/Task](workflow.md))*
  - Look up: task (from `event.subject`)
  - Transition the application from submitted to under_review when a caseworker claims the intake review task
  - Create an Interview record when a caseworker claims an application_review task; SNAP requires an interview before determination (7 CFR § 273.2(e))
- **`intake.application.submitted`** *(emitted by [Intake/Application](intake.md#application))*
  - Look up: application (from `event.subject`)
  - Create electronic Verifications per member and document Verifications at the household level for the given program
  - Create electronic Verifications per member and document Verifications at the household level for the given program
- **`data_exchange.call.completed`**
  - Look up: verification (from `event.data.metadata.intake.verificationId`)
  - Transition the Verification based on the service call result; on inconclusive, creates a document fallback per ex parte rules (42 CFR § 435.911)
- **`scheduling.appointment.scheduled`**
  - Append the appointmentId to Interview.appointments when an appointment is scheduled against an interview subject. Non-interview appointments (subjectType != interview) are ignored.
- **`document_management.version.uploaded`**
  - Look up: verification (from `event.data.metadata.intake.verificationId`)
  - Satisfy the Verification and record the uploaded document version as evidence; trigger only fires when metadata.intake.verificationId resolves to a known Verification
- **`eligibility.application.determination_completed`**
  - Look up: member (from `event.data.memberId`)
  - Write eligibility outcome to ApplicationMember.programDeterminations. Informational write-back only — does not trigger application close. Medicaid RTE results may arrive before intake closes; SNAP results typically arrive after.
- **`eligibility.application.all_determined`**
  - Close the application when all program+member combinations are determined
- **`eligibility.application.expedited`**
  - Set isExpedited on the application when eligibility screening confirms expedited criteria are met

---

## Verification

### Transitions

- **satisfy** — System marks an obligation as satisfied after receiving conclusive service call or document evidence
  - Actors: system only
  - Transition: `pending`/`inconclusive` → `satisfied`
  - Record when the obligation was satisfied (sets `satisfiedAt`)
  - Emit: `intake.verification.satisfied` — signals the obligation is fulfilled
- **mark-inconclusive** — System records that a service call returned inconclusive, triggering document fallback
  - Actors: system only
  - Transition: `pending` → `inconclusive`
  - Emit: `intake.verification.inconclusive` — triggers document fallback creation via intake rule subscription
- **waive** — Caseworker grants a waiver for an obligation that cannot be satisfied through normal means
  - Actors: caseworker, or supervisor
  - Transition: `pending`/`inconclusive` → `waived`
  - Record when the waiver was granted (sets `waivedAt`)
  - Emit: `intake.verification.waived` — signals the obligation is resolved without evidence
- **mark-cannot-verify** — Caseworker closes an obligation when all available verification methods are exhausted
  - Actors: caseworker, or supervisor
  - Transition: `pending`/`inconclusive` → `cannot_verify`
  - Record when the obligation was closed as cannot-verify (sets `closedAt`)

### Event subscriptions

- **`intake.verification.created`**
  - Look up: application (from `event.data.applicationId`)
  - Route each electronic Verification to its required service calls by category; document-type Verifications are skipped by initiateServiceCall
