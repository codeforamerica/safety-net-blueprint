# Intake State Machine

Domain: `intake` | API spec: [intake-openapi.yaml](../../../contracts/intake-openapi.yaml) | State machine: [intake-state-machine.yaml](../../../contracts/intake-state-machine.yaml)

---

## Application

### Actions

- **submit** — Formally submits a draft application, starting the regulatory processing clock
  - Actors: applicant, or case_worker
  - Transition: `draft` → `submitted`
  - Record when the application was formally submitted (sets `submittedAt`)
  - Emit: `intake.application.undefined` — starts the regulatory clock; triggers caseworker task creation, confirmation notice, and person matching
- **open** — System marks a submitted application as under active caseworker review
  - Actors: system only
  - Transition: `submitted` → `under_review`
  - Emit: `intake.application.undefined` — signals caseworker has begun active review
- **complete-review** — Caseworker signals data collection is complete and the application is ready for determination
  - Actors: case_worker, or supervisor
  - Transition: no state change
  - Emit: `intake.application.undefined` — signals data collection is complete; triggers eligibility determination
- **submit-for-approval** — System routes the application to supervisor review when state-configured approval thresholds are met
  - Actors: system only
  - Transition: `under_review` → `pending_approval`
  - Emit: `intake.application.undefined` — triggers supervisor approval task creation; states configure approval thresholds via rules overlay
- **approve-determination** — Supervisor approves the determination; closes the application and triggers NOA and case creation
  - Actors: supervisor
  - Transition: `pending_approval` → `closed`
  - Record when the intake phase closed (sets `closedAt`)
  - Emit: `intake.application.undefined` — signals intake is complete; triggers case creation
- **reject-determination** — Supervisor rejects the determination and returns the application to the caseworker for revision
  - Actors: supervisor
  - Transition: `pending_approval` → `under_review`
  - Emit: `intake.application.undefined` — signals the determination was rejected; workflow returns the caseworker task to in_progress via return-to-worker
- **close** — Marks a reviewed application as closed after all determinations are complete
  - Actors: case_worker, supervisor, or system
  - Transition: `under_review` → `closed`
  - Record when the intake phase closed (sets `closedAt`)
  - Emit: `intake.application.undefined` — signals intake is complete; triggers case creation
- **withdraw** — Applicant or caseworker withdraws the application before a decision is made
  - Actors: applicant, case_worker, or supervisor
  - Transition: `submitted`/`under_review` → `withdrawn`
  - Record when the application was withdrawn (sets `withdrawnAt`)
  - Emit: `intake.application.undefined` — triggers open task cancellation and withdrawal notice

### Event subscriptions

- **`undefined`**
  - Look up: task (from `event.subject`)
  - Transition the application from submitted to under_review when a caseworker claims the intake review task
  - Create an Interview record when a caseworker claims an application_review task; SNAP requires an interview before determination (7 CFR § 273.2(e))
- **`undefined`**
  - Look up: application (from `event.subject`)
  - Create electronic Verifications per member (identity, citizenship, immigration) and per income source (income), and document Verifications at the household level for the given program. Residency is a SNAP-required household-level obligation (7 CFR § 273.2(f)(1)(iii)) — no electronic check exists, so it is created as document-type.
  - Create electronic Verifications per member (identity, citizenship, immigration) and per income source (income), and document Verifications at the household level for the given program. Residency is a SNAP-required household-level obligation (7 CFR § 273.2(f)(1)(iii)) — no electronic check exists, so it is created as document-type.
- **`undefined`**
  - Look up: verification (from `event.data.metadata.intake.verificationId`)
  - Transition the Verification based on the service call result; on inconclusive, creates a document fallback per ex parte rules (42 CFR § 435.911)
- **`undefined`**
  - Append the appointmentId to Interview.appointments when an appointment is scheduled against an interview subject. Non-interview appointments (subjectType != interview) are ignored.
- **`undefined`**
  - Look up: verification (from `event.data.metadata.intake.verificationId`)
  - Satisfy the Verification and record the uploaded document version as evidence; trigger only fires when metadata.intake.verificationId resolves to a known Verification
- **`undefined`**
  - For each:
- **`undefined`**
  - Look up: member (from `event.data.memberId`)
  - Write eligibility outcome to ApplicationMember.programDeterminations. Informational write-back only — does not trigger application close. Medicaid RTE results may arrive before intake closes; SNAP results typically arrive after.
- **`undefined`**
  - If `false`:
    - Route to supervisor approval when state-configured thresholds are met; states replace this condition with their CEL threshold expression via rules overlay
  - Else:
    - Close the application when all determinations are in and no supervisor approval is required
- **`undefined`**
  - Set isExpedited on the application when eligibility screening confirms expedited criteria are met
- **`undefined`**
  - Look up: member (from `event.subject`)
  - Set personId and personMatch on ApplicationMember; personId is set only on confirmed matches
- **`undefined`**
  - Look up: verification (from `event.data.metadata.intake.verificationId`)
  - `PATCH intake/applications/verifications/$verification.id`

---

## Verification

### Actions

- **satisfy** — System marks an obligation as satisfied after receiving conclusive service call or document evidence
  - Actors: system only
  - Transition: `pending`/`inconclusive` → `satisfied`
  - Record when the obligation was satisfied (sets `satisfiedAt`)
  - Emit: `intake.verification.undefined` — signals the obligation is fulfilled
- **mark-inconclusive** — System records that a service call returned inconclusive, triggering document fallback
  - Actors: system only
  - Transition: `pending` → `inconclusive`
  - Emit: `intake.verification.undefined` — triggers document fallback creation via intake rule subscription
- **waive** — Caseworker grants a waiver for an obligation that cannot be satisfied through normal means
  - Actors: case_worker, or supervisor
  - Transition: `pending`/`inconclusive` → `waived`
  - Record when the waiver was granted (sets `waivedAt`)
  - Emit: `intake.verification.undefined` — signals the obligation is resolved without evidence
- **mark-cannot-verify** — Caseworker closes an obligation when all available verification methods are exhausted
  - Actors: case_worker, or supervisor
  - Transition: `pending`/`inconclusive` → `cannot_verify`
  - Record when the obligation was closed as cannot-verify (sets `closedAt`)

### Event subscriptions

- **`undefined`**
  - Look up: application (from `event.data.applicationId`)
  - Route each electronic Verification to its required service calls by category; document-type Verifications are skipped by initiateServiceCall
