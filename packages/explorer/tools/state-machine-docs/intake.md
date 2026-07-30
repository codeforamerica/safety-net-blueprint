# Intake State Machine

Domain: `intake` | API spec: [intake-openapi.yaml](../../../contracts/intake-openapi.yaml) | State machine: [intake-state-machine.yaml](../../../contracts/intake-state-machine.yaml)

---

## Application

### Actions

- **submit** — Formally submits a draft application, starting the regulatory processing clock
  - Actors: applicant, or case_worker
  - Transition: `draft` → `submitted`
  - Record when the application was formally submitted (sets `submittedAt`)
  - Emit: `intake.application.submitted` — starts the regulatory clock; triggers caseworker task creation, confirmation notice, and person matching
    - Subscribed by: [Eligibility/Determination](eligibility.md#determination), [Intake/Application](intake.md#application), [Workflow/Task](workflow.md)
- **open** — System marks a submitted application as under active caseworker review
  - Actors: system only
  - Transition: `submitted` → `under_review`
  - Emit: `intake.application.opened` — signals caseworker has begun active review
- **complete-review** — Caseworker signals data collection is complete and the application is ready for determination
  - Actors: case_worker, or supervisor
  - Transition: no state change
  - Emit: `intake.application.review_completed` — signals data collection is complete; triggers eligibility determination
    - Subscribed by: [Eligibility/Determination](eligibility.md#determination)
- **submit-for-approval** — System routes the application to supervisor review when state-configured approval thresholds are met
  - Actors: system only
  - Transition: `under_review` → `pending_approval`
  - Emit: `intake.determination.approval_needed` — triggers supervisor approval task creation; states configure approval thresholds via rules overlay
    - Subscribed by: [Workflow/Task](workflow.md)
- **approve-determination** — Supervisor approves the determination; closes the application and triggers NOA and case creation
  - Actors: supervisor
  - Transition: `pending_approval` → `closed`
  - Record when the intake phase closed (sets `closedAt`)
  - Emit: `intake.application.closed` — signals intake is complete; triggers case creation
    - Subscribed by: [Workflow/Task](workflow.md)
- **reject-determination** — Supervisor rejects the determination and returns the application to the caseworker for revision
  - Actors: supervisor
  - Transition: `pending_approval` → `under_review`
  - Emit: `intake.determination.rejected` — signals the determination was rejected; workflow returns the caseworker task to in_progress via return-to-worker
    - Subscribed by: [Workflow/Task](workflow.md)
- **close** — Marks a reviewed application as closed after all determinations are complete
  - Actors: case_worker, supervisor, or system
  - Transition: `under_review` → `closed`
  - Record when the intake phase closed (sets `closedAt`)
  - Emit: `intake.application.closed` — signals intake is complete; triggers case creation
    - Subscribed by: [Workflow/Task](workflow.md)
- **withdraw** — Applicant or caseworker withdraws the application before a decision is made
  - Actors: applicant, case_worker, or supervisor
  - Transition: `submitted`/`under_review` → `withdrawn`
  - Record when the application was withdrawn (sets `withdrawnAt`)
  - Emit: `intake.application.withdrawn` — triggers open task cancellation and withdrawal notice
    - Subscribed by: [Eligibility/Determination](eligibility.md#determination)

### Event subscriptions

- **`workflow.task.claimed`**
  - Look up: task (from `event.subject`)
  - Transition the application from submitted to under_review when a caseworker claims the intake review task
  - Create an Interview record when a caseworker claims an application_review task; SNAP requires an interview before determination (7 CFR § 273.2(e))
- **`intake.application.submitted`**
  - Look up: application (from `event.subject`)
  - Create electronic Verifications per member (identity, citizenship, immigration) and per income source (income), and document Verifications at the household level for the given program. Residency is a SNAP-required household-level obligation (7 CFR § 273.2(f)(1)(iii)) — no electronic check exists, so it is created as document-type.
  - Create electronic Verifications per member (identity, citizenship, immigration) and per income source (income), and document Verifications at the household level for the given program. Residency is a SNAP-required household-level obligation (7 CFR § 273.2(f)(1)(iii)) — no electronic check exists, so it is created as document-type.
- **`data_exchange.call.completed`**
  - Look up: verification (from `event.data.metadata.intake.verificationId`)
  - Transition the Verification based on the service call result; on inconclusive, creates a document fallback per ex parte rules (42 CFR § 435.911)
- **`scheduling.appointment.scheduled`**
  - Append the appointmentId to Interview.appointments when an appointment is scheduled against an interview subject. Non-interview appointments (subjectType != interview) are ignored.
- **`document_management.document_version.uploaded`**
  - Look up: verification (from `event.data.metadata.intake.verificationId`)
  - Satisfy the Verification and record the uploaded document version as evidence; trigger only fires when metadata.intake.verificationId resolves to a known Verification
- **`eligibility.determination.created`**
  - For each:
- **`eligibility.application.decision_completed`**
  - Look up: member (from `event.data.memberId`)
  - Write eligibility outcome to ApplicationMember.programDeterminations. Informational write-back only — does not trigger application close. Medicaid RTE results may arrive before intake closes; SNAP results typically arrive after.
- **`eligibility.application.determination_completed`**
  - If `false`:
    - Route to supervisor approval when state-configured thresholds are met; states replace this condition with their CEL threshold expression via rules overlay
  - Else:
    - Close the application when all determinations are in and no supervisor approval is required
- **`eligibility.application.expedited`**
  - Set isExpedited on the application when eligibility screening confirms expedited criteria are met
- **`client_management.person.match_resolved`**
  - Look up: member (from `event.subject`)
  - Set personId and personMatch on ApplicationMember; personId is set only on confirmed matches
- **`intake.member_income.created`**
  - Look up: member (from `event.subject`), application (from `$member.applicationId`)
  - If `$application.status is not "draft" and $application.status is not "withdrawn" and $application.status is not "closed"`:
    - If `"snap" in $application.programsAppliedFor`:
      - `POST intake/applications/verifications`
- **`intake.application_member.created`**
  - Look up: application (from `event.subject`)
  - If `$application.status is not "draft" and $application.status is not "withdrawn" and $application.status is not "closed"`:
    - If `"snap" in $application.programsAppliedFor`:
      - `POST intake/applications/verifications`
    - If `"medicaid" in $application.programsAppliedFor`:
      - `POST intake/applications/verifications`
      - `POST intake/applications/verifications`
- **`communication.notice.sent`**
  - Look up: verification (from `event.data.metadata.intake.verificationId`)
  - `PATCH intake/applications/verifications/$verification.id`

---

## Verification

### Actions

- **satisfy** — System marks an obligation as satisfied after receiving conclusive service call or document evidence
  - Actors: system only
  - Transition: `pending`/`inconclusive` → `satisfied`
  - Emit: `intake.verification.satisfied` — signals the obligation is fulfilled
- **mark-inconclusive** — System records that a service call returned inconclusive, triggering document fallback
  - Actors: system only
  - Transition: `pending` → `inconclusive`
  - Emit: `intake.verification.inconclusive` — triggers document fallback creation via intake rule subscription
- **waive** — Caseworker grants a waiver for an obligation that cannot be satisfied through normal means
  - Actors: case_worker, or supervisor
  - Transition: `pending`/`inconclusive` → `waived`
  - Emit: `intake.verification.waived` — signals the obligation is resolved without evidence
- **mark-cannot-verify** — Caseworker closes an obligation when all available verification methods are exhausted
  - Actors: case_worker, or supervisor
  - Transition: `pending`/`inconclusive` → `cannot_verify`
  - Emit: `intake.verification.cannot_verify` — signals all available verification methods are exhausted

### Event subscriptions

- **`intake.verification.created`**
  - Look up: application (from `event.data.applicationId`)
  - Route each electronic Verification to its required service calls by category; document-type Verifications are skipped by initiateServiceCall
