# Intake Domain: Design Reference

Industry research and design decisions for the intake domain, covering process, regulations, data model, events, and lifecycle. Informed by how major government benefits platforms implement intake for SNAP, Medicaid, and TANF, and by the federal regulations that govern each program.

See [Intake Domain](intake.md) for the architecture overview and [Contract-Driven Architecture](../contract-driven-architecture.md) for the contract approach.

**Systems compared:** IBM Cúram (Merative), Salesforce Public Sector Solutions, Pega Government Platform, CalSAWS/BenefitsCal, MAGI-in-the-Cloud (HHS), 18F SNAP API prototype, CMS Marketplace API

**Regulatory standards referenced:** 7 CFR Part 273 (SNAP), 42 CFR Part 435 (Medicaid/MAGI), 45 CFR Part 261 (TANF), ACA/MAGI household composition rules

---

## Overview

The intake domain is responsible for capturing and structuring the data a household submits when applying for benefits. It does not determine eligibility, manage ongoing cases, or deliver benefits — those are downstream domain concerns. The intake phase begins when an application is filed (starting the regulatory clock) and ends when the application data is complete enough to submit for eligibility determination — after data collection is finished (interviews conducted, documents received, verification complete), not when the applicant first clicks submit. This boundary follows the regulatory processing clock (7 CFR § 273.2, 42 CFR § 435.912), which starts at filing and runs until determination regardless of who collects the data — federal regulations make no distinction between client-submitted and caseworker-entered data for purposes of defining the application processing period.

All major platforms draw a hard boundary between the intake phase and the case management phase — the blueprint follows the same pattern: the intake domain owns the application record; eligibility and case management own what happens after.

---

## Core design elements

**Hard domain boundary.** Intake owns data collection and structuring; eligibility owns evaluation. The handoff is an event (`application.review_completed`), not a direct call — neither domain controls the other's state or calls the other's API at runtime.

**Cross-domain data alignment.** `ApplicationMember` composes from `member.yaml` via `allOf`; financial sub-resource schemas live in `schemas/common/`. Eligibility reads the same shapes intake produces without field-mapping at the adapter layer.

**State machine-driven behavior.** Actions (explicit transitions) and event handlers (reactive logic triggered by events from other domains) drive all intake behavior — verification record creation, service call fan-outs, task creation, write-backs. Behavior is declared in the state machine configuration and customized via overlay, not hardcoded in the domain service.

**Unified verification.** A single `Verification` entity and lifecycle covers both electronic checks and paper document requirements. This directly encodes the ex parte two-phase flow: electronic check first, document request only if inconclusive.

**Neutral caseworker review surface.** The `ReviewContext` composite view assembles current application state server-side. The front end organizes it for whatever review workflow the state uses; writes go through individual sub-resource endpoints.

---

## Program scope

The baseline covers programs administered through state human services agencies that share a common MAGI/income-maintenance intake pipeline. **SNAP**, **Medicaid/MAGI**, and **CHIP** are first-class programs — all three carry substantial federal intake requirements (processing deadlines, verification obligations, interview or ex parte rules) and are commonly administered together through a joint application. CHIP follows the same MAGI household composition methodology as Medicaid and is typically co-processed on the same application.

**TANF** is supported as a thin baseline. Federal requirements are minimal (45 CFR Part 261): states have broad discretion over intake procedures, there is no federal interview requirement, and there is no prescribed processing deadline. TANF-specific intake customization is a state overlay concern.

Programs administered by federal agencies or separate state agency systems are out of scope: SSI and SSDI are administered by SSA; Medicare by CMS; unemployment insurance by state labor departments; housing assistance by housing authorities. Programs in the same administrative lane but using materially different intake models are also out of scope for the baseline — WIC uses clinical certification requiring a licensed professional; CCDF involves provider selection and provider agreements. These may be addressed in future domain designs.

---

## What happens during intake

The intake phase spans from filing through caseworker review and data collection. The key activities and their sequence:

1. **Filing** — applicant submits a minimally complete application; regulatory clock starts; the application enters the caseworker queue for review covering all programs applied for
2. **Confirmation notice** — the agency sends an acknowledgment to the household confirming receipt of the application and the filing date; many states are required to provide this notice
3. **Identity matching** — the agency attempts to match the applicant and household members to existing person records to prevent duplicate records and link to prior application history; see [Decision 7](#decision-7-person-identity-matching)
4. **Queue assignment and routing** — the application is routed to the appropriate caseworker based on program type, geography, workload, or other agency-configured rules
5. **Automated eligibility determination (Medicaid)** — for MAGI Medicaid, the agency immediately attempts real-time eligibility (RTE) via the Federal Data Services Hub (FDSH) using SSA income data, IRS tax data, and citizenship/immigration status; if RTE succeeds, Medicaid is auto-approved or auto-denied with no caseworker involvement; if inconclusive, Medicaid proceeds to caseworker review; this runs before any caseworker action (45 CFR § 435.911–435.916)
6. **Electronic data source checks** — in parallel with or shortly after filing, the agency queries electronic data sources to pre-populate or verify applicant-reported data: IEVS/The Work Number for income and employment, SAVE for immigration and citizenship status, SSA for disability and benefit receipt; results inform the caseworker's review but do not replace it
7. **Expedited screening** — for SNAP, the caseworker must determine within 1 business day whether the household qualifies for expedited processing (7-day track)
8. **Caseworker review and data correction** — the caseworker reviews what the applicant submitted for accuracy and completeness; the caseworker may update, add, or correct application data on behalf of the household based on what they learn during the interview and document review
9. **Interview** — SNAP requires an interview at initial certification; some states waive this for renewals or specific populations; information gathered in the interview may result in updates to the application data (steps 8 and 9 are often interleaved)
10. **Document collection and verification** — the caseworker requests supporting documents; the applicant has at least 10 days to provide them (SNAP); documents may trigger further data corrections
11. **Data completion** — once the caseworker is satisfied that the application data is accurate and complete, the application is ready for eligibility determination; this is when the intake phase ends

---

## Regulatory requirements

### Processing clocks

Federal law sets maximum processing timelines that begin at application receipt — not when a caseworker picks up the application. The clock starts at filing regardless of how long it takes to assign the application to a worker.

**SNAP (7 CFR § 273.2(g)):** States must complete the eligibility determination within 30 calendar days of application receipt. The receipt date is the date the household submits a minimally complete application — one that includes at minimum the household's name, address, and a signature. For applications submitted through online portals after business hours, the receipt date is the next business day. Households that meet the expedited criteria (§ 273.2(i)) must be determined within 7 calendar days.

**Medicaid and CHIP (42 CFR § 435.912):** States must complete the eligibility determination within 45 calendar days of application receipt. When a disability determination is required before Medicaid eligibility can be established, the deadline extends to 90 days. CHIP does not carry a separate federal deadline; states administer Medicaid and CHIP on a joint application and process both on the same timeline.

**TANF:** No federal processing deadline. States define their own timelines.

### Program-specific requirements

**SNAP (7 CFR § 273.2):**

The agency must conduct an in-person or telephone interview with the household before making an eligibility determination (§ 273.2(e)). This requirement cannot be waived at initial certification — even if all income and household data can be verified electronically, the interview must still occur. The agency must notify the household of the interview date and time in writing, and document that the interview was completed before issuing any determination.

Within 1 business day of receiving the application, the agency must determine whether the household qualifies for expedited processing (§ 273.2(i)). Households that qualify must receive benefits within 7 days. The expedited determination uses only the data the household provided at submission — no verification or interview is required before making the expedited determination. Standard verification and the full caseworker interview proceed in parallel with benefit issuance for expedited cases.

If the agency requests verification documents, the applicant must be given at least 10 days to provide them (§ 273.2(f)). The agency may not deny the application solely for failure to provide documents until that period has passed.

All household members must be listed on the application regardless of whether they are individually applying for benefits (§ 273.1). Members who are ineligible — for example, non-citizens who do not qualify for SNAP — must still be listed because their income and resources are counted when calculating the benefit amount for the rest of the household.

**Medicaid and CHIP (42 CFR § 435.911–435.916):**

Before routing a Medicaid or CHIP application to a caseworker, the agency must attempt to make an eligibility determination using data available from federal electronic sources — IRS tax records, SSA income and citizenship data, and federal hub data for immigration status (§ 435.911). This is the ex parte rule: if the electronic data is sufficient to support a favorable determination, the agency must approve the applicant without requesting any additional information or documents. Requesting documents or involving a caseworker is only permitted when electronic sources are unavailable, return inconclusive data, or the available data is insufficient for a determination.

No caseworker interview is federally required for Medicaid or CHIP. When the ex parte process cannot resolve the application, it routes to a caseworker for manual review — but no interview requirement attaches to that review.

When an electronic check returns an inconclusive result, the agency must document the result and advance to the next step — requesting a document or routing for caseworker review — within the 45-day processing deadline (§ 435.916).

**TANF (45 CFR Part 261):**

Federal requirements for TANF intake are minimal. States have broad discretion over application procedures, interview requirements, and verification obligations. There is no federal mandate for automated determination, no prescribed interview structure, and no federal processing deadline. TANF-specific intake requirements are a state overlay concern.

### Verification requirements

Federal regulations prescribe which categories of information must be verified before certification and, for Medicaid and CHIP, whether electronic checks must be attempted before paper documents can be requested.

**SNAP (7 CFR § 273.2(f)):**

Before certifying a household, the agency must verify: the identity of the primary applicant; that the household resides in the state (verification is document-only — no electronic check exists for residency); citizenship or immigration status for each member applying for SNAP (non-citizens must document their immigration category); and income from all sources for all household members. States may not require verification of items beyond those listed in § 273.2(f)(1).

**Medicaid and CHIP (42 CFR § 435.940–435.965):**

The ex parte verification rule requires states to attempt electronic verification through designated federal data sources before requesting paper documents from the applicant. If an electronic source returns a conclusive result, the agency must use it — requesting a document when an electronic check is available and conclusive is not permitted. Only when an electronic source is unavailable or returns an inconclusive result may the agency request a paper document, and the agency must document that the electronic attempt was made.

Required electronic checks, in order of precedence:
- **Citizenship** — FDSH/SSA (`fdsh_ssa`) must be checked first; paper documents may be requested only if the check is inconclusive or unavailable
- **Immigration status** — FDSH VLP (`fdsh_vlp`) must be checked first; if inconclusive, USCIS SAVE (`save`) is checked next; paper documents are a last resort
- **Income** — IRS FDSH FTI (`fdsh_fti`) for tax-reported income; SSA IEVS (`ssa_ievs`) for Social Security and SSI benefit income
- **Identity** — FDSH/SSA (`fdsh_ssa`)

**IEVS (7 CFR § 272.8):**

The Income and Eligibility Verification System mandate requires states to query multiple federal income sources, but not all sources are real-time. The timing of each source determines whether it can be used at intake or only for ongoing case management:

- **SSA IEVS (SOLQ)** — real-time query; can run at application submission
- **IRS IEVS, SWICA (wage and employment records), UIB (unemployment benefits)** — batch-processed by the federal agencies on a quarterly cycle; results are not available at submission and are used for ongoing verification during case management, not initial certification

**Domain boundary:** Intake initiates all verification-related electronic checks at submission. Eligibility subscribes to the results and uses them for determination. See [Decision 14](#decision-14-existing-coverage-check-ownership) for why existing coverage checks (fdsh_medicare, fdsh_vci) are owned by eligibility rather than intake.

---

## Entity model

### Application

The root entity representing one submitted application from a household. All major platforms have an equivalent concept — an application-scoped record that is distinct from the downstream case or benefit assignment. No platform tracks the final determination (approved/denied) on the application itself; that lives on the program delivery case created after eligibility determination.

Key fields:
- `status` — `draft` (regulatory clock not running) | `submitted` (clock starts; triggers queue entry and automated Medicaid screening) | `under_review` (caseworker active) | `withdrawn` (all open tasks must be cancelled and the household notified) | `closed` (intake complete; case management creates a case if approved). Terminal states: `withdrawn`, `closed`.
- `programs` — which programs the household intends to apply for, assessed at submission for queue routing, expedited SNAP screening, and automated Medicaid determination. Distinct from `ApplicationMember.programs`, which records which members are applying for which programs — the two must be kept consistent (a member cannot apply for a program not listed at the application level).
- `submittedAt` — the regulatory clock anchor. SNAP's 30-day and Medicaid's 45-day processing deadlines run from this timestamp (7 CFR § 273.2, 42 CFR § 435.912). Not `createdAt` — a draft can be started and abandoned without starting the clock; the deadline starts when the application is formally filed.

See [Decision 2](#decision-2-programs-applied-for--placement), [Decision 3](#decision-3-authorized-representative--modeling), [Decision 4](#decision-4-intake-phase-end--lifecycle-state).

---

### ApplicationMember

A person linked to an application. May be the primary applicant, a household member applying for benefits, a household member counted but not applying, or an authorized representative. All major platforms have an equivalent member/participant record linked to the application.

SNAP requires all household members to be listed regardless of whether they are individually applying (7 CFR § 273.1).

Member data is organized by category — identity, eligibility attributes, financial data, household — and shared with the eligibility domain via common schemas, so states can overlay the parts relevant to their programs without touching everything else. See [Decision 15](#decision-15-applicationmember-composes-from-memberyaml).

Key fields:
- `roles` (array) — supports multiple simultaneous roles. An authorized representative who lives in the household holds `[authorized_representative, household_member]`; a SNAP-only authorized rep (who must be a non-household-member per 7 CFR § 273.2(n)) holds `[authorized_representative]` alone. A single `role` value cannot represent both roles on one record and would require a separate representative entity. See [Decision 3](#decision-3-authorized-representative--modeling).
- `programs` — per-member intent: which programs this specific member is applying for. Eligibility creates one Decision per member per program using this field — it determines who gets evaluated for what. Distinct from `Application.programs`, which is a household-level routing flag used at submission before member-level intent is relevant.
- `personId` — nullable foreign key to the Persons domain, populated by identity matching at submission. Null means unmatched or matching is still pending. Once set, downstream domains (eligibility, case management) can link to prior application history and existing case records for this person. See [Decision 7](#decision-7-person-identity-matching).

See [Decision 1](#decision-1-role-vs-relationship-on-applicationmember), [Decision 2](#decision-2-programs-applied-for--placement), [Decision 3](#decision-3-authorized-representative--modeling), [Decision 7](#decision-7-person-identity-matching).

---

### Verification

A unified record representing one item on the household's verification checklist — covering both paper document requirements (e.g., provide a pay stub) and electronic service check results (e.g., an FDSH citizenship check). All major platforms converge on a unified verification concept that covers both types. See [Decision 13](#decision-13-unified-verification-entity) for the choice.

Verification records are created by state machine event handlers in response to intake events, not manually by caseworkers under normal circumstances. Household-level obligations (e.g., proof of residency) are linked to the application only. Member-level obligations (e.g., proof of income, citizenship) are linked to both the application and the specific member.

Key fields:
- `memberId` — nullable. Null for household-level obligations (e.g., proof of residency, which applies to the household as a unit); set for member-level obligations (income, citizenship, immigration — each member is verified individually). The same entity and endpoint represent both scopes via this single nullable field.
- `category` — the obligation type: `income | identity | residency | citizenship | immigration`. Determines which electronic service to call first (if any) and what documents to request as a fallback. `residency` is document-only — no electronic check exists (7 CFR § 273.2(f)(1)(iii)). `citizenship` and `immigration` trigger FDSH service calls before any document request is made.
- `status` — `pending` (not yet resolved) | `inconclusive` (electronic check returned insufficient data; document fallback triggered) | `satisfied` (verified) | `waived` | `cannot_verify`. The `pending → inconclusive → satisfied` path is the two-phase flow that ex parte rules mandate for citizenship and immigration (42 CFR § 435.911): electronic check first, document request only if inconclusive.
- `evidence[]` — sub-items accumulating both electronic results (service called, result received, timestamp) and document submissions (documentId, receivedAt) on the same record. A split model — electronic checks tracked separately from documents — would require caseworkers to consult two data structures to see the full verification state and would prevent a single lifecycle from covering both obligation types.

See [Decision 9](#decision-9-verification-checklist-generation), [Decision 13](#decision-13-unified-verification-entity).

---

### Interview

A regulatory tracking entity representing the required SNAP interview obligation for an application. Distinct from individual appointments — one interview requirement may involve multiple appointments due to rescheduling or no-shows. The caseworker attests which appointment satisfied the interview obligation by setting `completedAt`.

Intake owns this entity because the obligation is regulatory (7 CFR § 273.2(e)) and tied to the application lifecycle. The scheduling domain owns the appointment mechanics (time, location, confirmation, reminders). Intake tracks whether the regulatory requirement is satisfied, not the scheduling details.

Key fields:
- `appointments` (array) — IDs of scheduling-domain appointments linked to this interview obligation. One-to-many: an interview requirement may span multiple appointments due to reschedules, no-shows, or missed connections. The Interview entity exists to track the obligation across these attempts — without it, there is no way to know whether the regulatory requirement has been satisfied when multiple appointments exist.
- `completedAt` — the caseworker's explicit attestation that the SNAP interview requirement (7 CFR § 273.2(e)) is satisfied. Not set automatically when an appointment ends — the caseworker designates which appointment completed the obligation. The scheduling domain tracks appointment end times; intake tracks regulatory compliance via this field.

**Linkage constraint:** The `scheduling.appointment.scheduled` subscription can link an appointment to the correct Interview only when the caseworker schedules from within the application context, so the scheduling system can populate `subjectType: interview` and `subjectId: {interviewId}` on the appointment automatically. Scheduling from a standalone module without that context produces an unlinked appointment.

See [Decision 10](#decision-10-interview-entity-model).

---

### Review progress

A per-section tracking record for the caseworker's review of an application. Entries are server-initialized at `submitted → under_review` — one per household section and one per member × member-scoped section. Clients update entries by id. Records are informational: they do not gate the `complete-review` transition, which states can optionally enforce via overlay. See [Decision 17](#decision-17-review-progress-is-a-separate-queryable-resource).

Key fields:
- `section` + `memberId` (composite key) — upsert semantics: submitting progress for the same section and member replaces the existing entry rather than creating a duplicate. `memberId` is nullable; sections without a member context (e.g., household expenses) use `section` alone as the key.
- `status` — `not_started | in_progress | complete | flagged`. The enum is overlay-extensible: states can add values like `needs_supervisor_review` for exception workflows without modifying the baseline contract. Status is navigation state only — `complete` does not gate the `complete-review` state machine transition in the baseline.

---

### Notes

A caseworker-entered note on an application. Notes are scoped to the application as a whole (`scope: application`) or to a specific section (`scope: section`), with an optional `memberId` for member-specific observations. The `textFormat` field controls rendering: `plain`, `markdown`, or `html`. Notes are standalone records — they do not affect application lifecycle and are preserved after the application is closed for audit purposes.

Key fields:
- `scope` — `application` (note applies to the whole application) or `section` (note applies to a specific review section). Both `section` and `memberId` are nullable: a note can target the whole application, a specific section, a specific member, or a specific member within a specific section — all through the same resource and endpoint, filtered by query params (`?scope=`, `?section=`, `?memberId=`). Per-scope endpoints would fragment the query interface across multiple paths and make cross-scope note queries impossible without multiple calls.

See [Customization — Note text format](#note-text-format) and [Customization — Note attachments](#note-attachments).

---

### ReviewContext

A read-only composite view assembled server-side for the caseworker review surface. Not a stored entity — assembled on request from the application's sub-resources. Returns the application, household, all members with their sub-resources (demographics, income, expenses, assets, employment, health coverage), current review-progress entries, and notes. The structure is neutral: it carries the data; the front end organizes it for whatever review workflow the state uses — per member, per section, or filtered by program.

Writes do not go through this endpoint. Each sub-resource retains its own write path. `ReviewContext` is always current state; change history is via `GET /platform/events?subject={applicationId}`.

See [Decision 16](#decision-16-review-surface-uses-the-composite-view-pattern).

---

## Application lifecycle

### States

Based on regulatory requirements and vendor consensus:

| State | Description |
|---|---|
| `draft` | Started but not yet submitted; no regulatory clock running |
| `submitted` | Formally submitted; regulatory clock starts |
| `under_review` | Assigned to a caseworker and being processed |
| `withdrawn` | Applicant voluntarily withdrew before determination |
| `closed` | Processing complete; determination made by eligibility domain |

**Implication for the data model:** Application data is mutable during `under_review`. The intake domain must support caseworker-initiated updates to application records, not just the applicant's initial submission. This has audit trail implications — changes made by caseworkers after submission should be distinguishable from the original submitted data. See [Audit trail pattern](../inter-domain-communication.md#audit-trail-pattern).

### Key transitions

- **submit**: `draft` → `submitted` — applicant files; regulatory clock starts; triggers caseworker task creation and confirmation notice
- **open**: `submitted` → `under_review` — caseworker begins actively reviewing the application; assignment may happen separately and does not necessarily trigger this transition; see [Decision 5](#decision-5-submitted--under_review-transition-trigger)
- **withdraw**: `submitted` | `under_review` → `withdrawn` — applicant-initiated; triggers open task cancellation
- **close**: `under_review` → `closed` — caseworker signals the application is ready for eligibility determination; see [Decision 4](#decision-4-intake-phase-end--lifecycle-state)

---

## Domain events

See [`docs/architecture/diagrams/intake-flow.mmd`](../diagrams/intake-flow.mmd) for a sequence diagram of the full intake flow across all domains.

### Event types

The intake domain emits two kinds of events:

**Lifecycle transition events** — named, semantic events tied to application state changes or significant caseworker actions (e.g., submission, withdrawal, expedited flag). Each carries a specific payload relevant to the transition.

**Generic resource events** — emitted on any create, update, or delete of the application or its sub-resources. These support audit and change-tracking consumers without requiring a named event for every data change. Sub-resource-level events are addressed when those sub-resources are designed. See [Domain events — scope](../inter-domain-communication.md#domain-events--scope).

### Event catalog

Events are listed with the operational or regulatory need that drives them — the reason a downstream domain needs to react, not just what happens to trigger them.

| Event | Why it's needed | Trigger | Primary consumers |
|---|---|---|---|
| `application.submitted` | Submission starts the regulatory clock (SNAP 30-day, Medicaid 45-day). Downstream domains cannot begin work until they know an application has been filed and when. See [Decision 8](#decision-8-post-submission-program-routing--task-creation-and-automated-eligibility) for how routing differs by program. | `draft` → `submitted` | Workflow, Communication (confirmation notice), Eligibility (automated determination for applicable programs) |
| `application.opened` | Signals that a caseworker has begun active review. Workflow needs to update the task state; supervisors tracking queue throughput need to know when review started vs. when it was filed. | `submitted` → `under_review` | Workflow (update task to in_progress) |
| `application.expedited_flagged` | SNAP requires a determination within 7 days for expedited households. The workflow domain needs to immediately escalate to a higher-priority SLA track — the standard 30-day task SLA is wrong for these cases. This is a named trigger effect, not a generic field update. | `flag-expedited` trigger | Workflow (escalate to expedited SLA) |
| `application.withdrawn` | A withdrawn application must stop all in-flight processing immediately. Open workflow tasks must be cancelled; any scheduled interview or document request must be voided; communication must notify the household. Failing to act on this event risks processing an application the household has abandoned. | any → `withdrawn` | Workflow (cancel open tasks), Communication (withdrawal notice) |
| `application.closed` | Signals that intake is complete and the application is ready for or has received an eligibility determination. Case Management needs this event to know when to create a service delivery case (if approved). Without it, case management has no trigger to act. | `under_review` → `closed` | Case Management (create case if approved), Eligibility |
| `application.review_completed` | Caseworker signals that data collection is complete and the application is ready for eligibility determination. No state change — application stays `under_review` until intake receives eligibility outcomes and closes itself. Eligibility needs this event to know when to begin determination; without it, eligibility has no trigger distinct from submission. | `complete-review` trigger (no state change) | Eligibility |

### Event subscriptions

Events from other domains that intake reacts to:

| Event | Why intake subscribes | Action |
|---|---|---|
| `workflow.task.claimed` | A caseworker claiming the intake review task signals they have begun active review — intake should reflect this in the application lifecycle. See [Decision 5](#decision-5-submitted--under_review-transition-trigger). | Trigger `submitted → under_review` on the linked application |
| `eligibility.determination_complete` | Eligibility publishes outcomes per program; intake subscribes to determine when all programs are resolved and the application can be closed. See [Decision 4](#decision-4-intake-phase-end--lifecycle-state). | Trigger `close` when all programs are determined |
| `data-exchange.service-call.completed` | Ex parte rules require electronic verification before requesting paper documents. When an external service call returns a result, the state machine event handler transitions the affected `Verification` and appends an electronic evidence item — satisfied if conclusive, inconclusive if not; a document request entry is appended to `documentRequests[]` when inconclusive. See [Decision 9](#decision-9-verification-checklist-generation), [Decision 11](#decision-11-external-service-verification-write-backs), [Decision 12](#decision-12-data-exchange-orchestration). | State machine event handler transitions `Verification`; appends electronic evidence item; appends to `documentRequests[]` if inconclusive |
| `scheduling.appointment.scheduled` | Intake must link each scheduled appointment to the correct Interview entity so the appointments array stays current. Required for caseworkers to see appointment history and for the interview completion flow to be traceable. See [Decision 10](#decision-10-interview-entity-model). | State machine event handler appends the appointmentId to `Interview.appointments` for the linked interview |
| `document_management.document_version.uploaded` | When a new document version is uploaded, intake's state machine evaluates whether the upload satisfies a pending verification obligation. Without this event, intake has no trigger to mark the `Verification` as satisfied when a document is received. | State machine event handler transitions the matching `Verification` record to `satisfied` and records the document ID in its `evidence` list |

---

## Key design decisions

Quick reference — each decision is detailed in the section below.

| # | Decision | Summary |
|---|---|---|
| 1 | [Role vs. relationship on ApplicationMember](#decision-1-role-vs-relationship-on-applicationmember) | Separate `role` and `relationship` fields — no vendor conflates them. |
| 2 | [Programs applied for — placement](#decision-2-programs-applied-for--placement) | Both application-level and member-level programs lists. |
| 3 | [Authorized representative — modeling](#decision-3-authorized-representative--modeling) | `roles` array on ApplicationMember — supports multiple simultaneous roles. |
| 4 | [Intake phase end — lifecycle state](#decision-4-intake-phase-end--lifecycle-state) | Caseworker-triggered event, no new state — each domain owns its own transitions. |
| 5 | [submitted → under_review transition trigger](#decision-5-submitted--under_review-transition-trigger) | Intake subscribes to `task.claimed` — one caseworker action triggers both domains. |
| 6 | [Member-to-member relationship matrix (MAGI)](#decision-6-member-to-member-relationship-matrix-magi) | Relationship to primary applicant only — sufficient for SNAP and most MAGI cases; full pairwise matrix is a known gap. |
| 7 | [Person identity matching](#decision-7-person-identity-matching) | Matching triggered at submission; synchronous vs. asynchronous is an implementation choice. |
| 8 | [Post-submission program routing — task creation and automated eligibility](#decision-8-post-submission-program-routing--task-creation-and-automated-eligibility) | One intake task per application with per-program status — programs under automated processing marked at task creation. |
| 9 | [Verification checklist generation](#decision-9-verification-checklist-generation) | Rules-driven `Verification` records cover both paper document requirements and electronic check obligations. |
| 10 | [Interview entity model](#decision-10-interview-entity-model) | Dedicated Interview entity in intake — not a generic appointment type; scheduling owns mechanics, intake owns regulatory tracking. |
| 11 | [External service verification write-backs](#decision-11-external-service-verification-write-backs) | Obligation status → `Verification` record; verified facts → `ApplicationMember` fields. |
| 12 | [Data exchange orchestration](#decision-12-data-exchange-orchestration) | Intake rules create `data-exchange/service-calls` resources — data exchange stays generic; field mapping lives in rules. |
| 13 | [Unified Verification entity](#decision-13-unified-verification-entity) | Obligation-centric `Verification` entity — evidence accumulates as sub-items; replaces `ApplicationDocument` and `ApplicationMember.verifications[]`. |
| 14 | [Existing coverage check ownership](#decision-14-existing-coverage-check-ownership) | fdsh_medicare and fdsh_vci are eligibility's calls — not intake Verification obligations. |
| 15 | [ApplicationMember composes from member.yaml](#decision-15-applicationmember-composes-from-memberyaml) | `allOf` composition — structural alignment with eligibility's MemberContext enforced by the schema hierarchy. |
| 16 | [Review surface uses the composite view pattern](#decision-16-review-surface-uses-the-composite-view-pattern) | Server-assembled neutral composite — front end organizes for its workflow; writes still use sub-resource endpoints. |
| 17 | [Review-progress is a separate queryable resource](#decision-17-review-progress-is-a-separate-queryable-resource) | Dedicated resource with bounded dataset — navigation state kept separate from application and workflow entities. |
| 18 | [Notes are a first-class resource](#decision-18-notes-are-a-first-class-resource) | Standalone resource with scope field — decoupled from review-progress, independently queryable at all scoping levels. |
| 19 | [Application submitted event payload — lean vs. enriched](#decision-19-application-submitted-event-payload--lean-vs-enriched) | Keep the submitted event lean; Intake reads member-program data directly from its own records when seeding Eligibility. |

---

### Decision 1: Role vs. relationship on ApplicationMember

**Status:** Decided: B

**What's being decided:** An `ApplicationMember` record captures two distinct attributes: the person's role in the application process (primary applicant, household member, authorized representative) and their family relationship to the primary applicant (spouse, child, parent). These can overlap — an authorized representative may also be a family member; a non-applying household member has no application role but does have a family relationship that matters for MAGI tax-household composition. A single field cannot represent both simultaneously. The decision is whether to encode both in one field or maintain them as separate fields.

**Considerations:**
- No major vendor conflates these — Cúram, Salesforce, and Pega all have separate fields for application-process role and family relationship

**Options:**
- **(A)** Single `relationship` field encoding both application role and family relationship
- **(B)** ✓ Separate `role` field (application process role: primary_applicant, household_member, non_applying_member, authorized_representative, absent_parent) and `relationship` field (family relationship to primary applicant: spouse, child, parent, etc.). Note: [Decision 3](#decision-3-authorized-representative--modeling) extends this to a `roles` array to support multiple simultaneous roles.

---

### Decision 2: Programs applied for — placement

**Status:** Decided: C

**What's being decided:** Programs-applied-for serves two distinct purposes that operate at different levels. At submission, the agency needs a household-level list — which programs the household intends to apply for — to route the application and trigger program-specific automated processing (SNAP expedited screening, Medicaid real-time eligibility). After submission, eligibility determination operates per person per program — Medicaid evaluates each member individually, and SNAP allows individual members to be excluded. Tracking only at the application level loses individual intent; tracking only at the member level removes the household-level routing flag needed at submission. The decision is whether to maintain one list, the other, or both.

**Considerations:**
- All major vendors track programs at the application level — this part is universal. Per-member tracking is less standardized: Cúram and CalSAWS use a boolean on the member; Pega infers member intent from eligibility rules.
- Vendors that rely on the eligibility engine cannot distinguish an ineligible member from one who voluntarily opted out — that distinction is lost at intake

**Options:**
- **(A)** Application level only — one programs list on Application, member-level distinction inferred downstream
- **(B)** Member level only — each ApplicationMember has a `programs` list; application-level programs list derived from member data
- **(C)** ✓ Both — Application has a programs list (screening/routing flag — which programs the household intends to apply for, used at submission for queue routing, expedited screening, and automated eligibility triggering), ApplicationMember has a `programs` list (individual intent — which members are applying for which programs); eligibility determination operates at the member level via `member.programs`; makes voluntary non-application explicit; gives eligibility a clean input

---

### Decision 3: Authorized representative — modeling

**Status:** Decided: C

**What's being decided:** An authorized representative participates in the application but the role is federally constrained differently per program. SNAP (7 CFR § 273.2(n)) requires the authorized rep to be a non-household-member — they cannot also appear as a regular household member. Medicaid (42 CFR § 435.923) is less restrictive — a household member may act as authorized representative, meaning one person legitimately holds both roles simultaneously. The data model must represent both: a SNAP-only authorized rep who is not in the household, and a Medicaid authorized rep who is also a household member.

**Considerations:**
- Salesforce and Cúram model the authorized representative as a role on the member record — no separate entity. Pega uses a separate reference from the Application.
- A `roles` array resolves the SNAP/Medicaid conflict: a SNAP-only authorized rep carries `[authorized_representative]`; a Medicaid authorized rep who lives in the household carries `[household_member, authorized_representative]`

**Options:**
- **(A)** Single `role` value on ApplicationMember (`role: authorized_representative`) — consistent with Salesforce and Cúram; simpler; conceptually imprecise for SNAP
- **(B)** Separate reference on Application pointing to a person record — consistent with Pega; accurate for SNAP's non-household-member requirement; adds a separate relationship to manage
- **(C)** ✓ `roles` array on ApplicationMember — keeps the authorized rep as a member record (no separate entity); allows multiple simultaneous roles; accurately represents both SNAP (non-household-member has no `household_member` role) and Medicaid (household member can hold both roles)

---

### Decision 4: Intake phase end — lifecycle state

**Status:** Decided: C

**What's being decided:** The intake application reaches `closed` only after eligibility has determined all programs — but intake shouldn't depend on eligibility to write that transition; each domain owns its own state. The caseworker also has a meaningful completion moment ("my part is done, ready for determination") that downstream systems need to react to. The decision is how to surface that signal and how the application reaches `closed` without coupling intake's lifecycle to the eligibility domain.

**Considerations:**
- Processing clocks start at submission, not at "intake complete" — the caseworker completion signal is an audit point, not a compliance trigger
- Each domain should own its own state transitions; having eligibility close the application directly couples intake's lifecycle to another domain
- A `pending_determination` state creates multi-program ambiguity (SNAP review may be complete while Medicaid automated processing is still running) and implies eligibility can't begin until intake signals ready — but expedited screening already runs before caseworker review

**Options:**
- **(A)** No explicit signal — application moves to `closed` when intake's logic determines all programs are resolved; fluid boundary similar to Cúram
- **(B)** Explicit `pending_determination` state — caseworker transitions the application; intake emits `application.review_completed`; adds a state and a step
- **(C)** ✓ Caseworker-triggered event, no new state — caseworker action emits `application.review_completed` while the application stays `under_review`; intake subscribes to eligibility events and closes the application when all programs are determined; each domain owns its own state transitions

---

### Decision 5: submitted → under_review transition trigger

**Status:** Decided: B

**What's being decided:** In the blueprint, workflow and intake are separate domains. When a caseworker claims the intake review task, two things should happen: the workflow task moves to in-progress, and the application transitions from `submitted` to `under_review`. Because they're separate domains, this doesn't happen automatically — either the caseworker (or the UI) makes two calls, or intake subscribes to the workflow event and transitions itself. The decision is whether the `submitted → under_review` transition requires an explicit intake API call or is driven by intake reacting to `workflow.task.claimed`.

**Considerations:**
- All major vendors handle this within a single system — the cross-domain question doesn't arise. The blueprint separates them.
- Subscribing to `task.claimed` is not tight coupling — intake still owns the transition; the event is the trigger, consistent with [Decision 4](#decision-4-intake-phase-end--lifecycle-state)

**Options:**
- **(A)** Explicit intake action — caseworker calls the intake domain API to open the application; intake owns the state change; requires an extra step
- **(B)** ✓ Intake subscribes to `task.claimed` — intake reacts to the workflow event and transitions the application to `under_review`; one caseworker action; consistent with the event-driven pattern established in [the audit trail pattern](../inter-domain-communication.md#audit-trail-pattern)

---

### Decision 6: Member-to-member relationship matrix (MAGI)

**Status:** Decided: A

**What's being decided:** [Decision 1](#decision-1-role-vs-relationship-on-applicationmember) established that each `ApplicationMember` carries a `relationship` field recording their family relationship to the primary applicant. This decision asks whether that field is sufficient or whether a full pairwise matrix — capturing relationships between any two household members — is required. MAGI Medicaid determines household composition from tax filing relationships, and most cases are covered by per-member fields (`claimedAsDependentBy`, `taxFilingStatus`) combined with relationship to the primary. But one edge case requires knowing the relationship between two non-primary members: a child not claimed as a tax dependent by anyone must be counted in the household of a parent also living in the household — a link that relationship-to-primary doesn't capture. The decision is whether to add a pairwise relationship matrix to cover this case or accept it as a known gap in the baseline.

**Considerations:**
- Cúram and MAGI-in-the-Cloud capture full pairwise relationships; Pega and CalSAWS capture only relationship to the primary applicant
- A pairwise matrix grows as N×(N-1) directed pairs; most intake forms guide applicants through dependency questions in a way that populates `claimedAsDependentBy` correctly, covering the gap in practice

**Options:**
- **(A)** ✓ Relationship to primary applicant only — `relationship` field on ApplicationMember; sufficient for SNAP and most MAGI cases when combined with `claimedAsDependentBy` and tax filing status fields; lean baseline
- **(B)** Full pairwise relationship matrix — separate relationship entity; covers all MAGI edge cases; consistent with Cúram and MAGI-in-the-Cloud; adds complexity for all states including those not implementing Medicaid

---

### Decision 7: Person identity matching

**Status:** Decided

**What's being decided:** When a household submits an application, the people in it may have prior application history or existing case records in the system. Without matching submitted applicants to existing person records, each application creates new person records — leading to duplicates, broken links to prior history, and eligibility determinations that can't account for prior benefit receipt. The question is whether to build identity matching into the intake contract (making `personId` a defined field on `ApplicationMember`) and when in the process to trigger it.

**Considerations:**
- All major vendors match within the same system; Cúram creates unresolved records at submission and resolves them afterward; Salesforce and Pega match at record creation
- Triggering at submission is the right moment: the caseworker should see prior history when they open the application for review; deferring loses that context

**Decision:** Identity matching is triggered at submission. `ApplicationMember` carries a nullable `personId` field populated by the matching process. Whether the implementation calls the identity service synchronously or asynchronously is left to the implementor.

---

### Decision 8: Post-submission program routing — task creation and automated eligibility

**Status:** Decided: B

**What's being decided:** After submission, each program on a multi-program application has a different federally-mandated processing path. SNAP requires a caseworker immediately — the interview cannot be bypassed and expedited screening must happen within 1 business day of receipt. Medicaid requires automated determination via FDSH before a caseworker may be involved — creating a caseworker task before RTE runs is premature and may be entirely unnecessary if automated processing resolves the application. A model that treats all programs identically at submission either creates unnecessary caseworker tasks for Medicaid or misses the expedited SNAP screening deadline. The decision is how to route each program correctly at submission and how many intake tasks to create for a multi-program application.

**Considerations:**
- All major integrated eligibility systems (CalSAWS, CBMS, Cúram, Salesforce PSS) treat intake review as application-scoped — one caseworker reviews all programs on one application; per-program tasks would duplicate that work
- Creating a caseworker task for Medicaid at submission is premature — the task may be unnecessary if RTE resolves the application automatically
- The blueprint cannot implement RTE (requires FDSH access), but must not preclude it; hardcoding "one task per program at submission" forces states to work around the baseline

**Options:**
- **(A)** One task per program at submission — simple, but incorrect for Medicaid and creates redundant caseworker work for multi-program applications
- **(B)** ✓ One intake task per application; program-type-aware per-program status — single task covers all programs; per-program status tells the caseworker what's pending automated processing; configurable routing in #163 sets the initial status and subscribes to eligibility resolution events
- **(C)** Two-phase routing — one shared intake task at submission; program-specific tasks fan out after intake closes — avoids duplication but delays program-specific processing and doesn't reflect how RTE actually works (Medicaid RTE runs before intake screening, not after)


---

### Decision 9: Verification checklist generation

**Status:** Decided: B

**What's being decided:** Federal regulations require states to verify specific facts before certifying a household, but what must be verified, how (electronic first or document-only), and whether a document can even be requested varies by program, member attributes, and state policy. For citizenship and immigration, ex parte rules (42 CFR § 435.911) prohibit requesting a document until an electronic check has been attempted — the obligation has two phases: electronic check first, document request only if inconclusive. The verification checklist must track both phases as part of the same obligation, not as separate structures. The question is how obligations are generated at submission — hardcoded in domain logic or driven by a configurable rules layer — and whether electronic and document obligations share one entity type or are split.

**Considerations:**
- All major platforms (Cúram, Pega, Salesforce) support configurable verification checklists driven by rules; none hardcode requirements in the intake entity
- A document-only checklist can't represent the ex parte two-phase flow: when FDSH returns verified, there is no document to track — the obligation is still satisfied; electronic results need a home in the checklist

**Options:**
- **(A)** Hardcoded in intake — requirements defined as static program-to-document mappings; simpler but not state-customizable
- **(B)** ✓ Rules-driven unified checklist — `all-match` rule sets generate `Verification` records covering both document and electronic obligations; states customize via overlay; intake domain has no verification requirement logic; consistent with Pega, Cúram, and Salesforce patterns; supports ex parte two-phase flow without a separate entity type

**Verification categories:** `income`, `identity`, `residency`, `citizenship`, `immigration`. Residency is SNAP-required (7 CFR § 273.2(f)(1)(iii)) and document-only — no electronic check exists. Citizenship and immigration are created per member, SNAP only.

---

### Decision 10: Interview entity model

**Status:** Decided: B

**What's being decided:** SNAP requires the agency to conduct an interview with the household before making an eligibility determination (7 CFR § 273.2(e)). This is a regulatory obligation tied to the application — it must be satisfied before the application can close, regardless of how many scheduling attempts are needed. An application may have three canceled appointments and still have an unsatisfied interview obligation. The interview obligation (has the SNAP requirement been satisfied?) is distinct from the scheduling mechanics (when and where is the appointment). If the obligation lives in the scheduling domain as a generic appointment type, scheduling must understand SNAP intake requirements. The decision is whether to model the regulatory obligation as a dedicated entity in intake or as a generic appointment record in the scheduling domain.

**Considerations:**
- Pega Government Platform models the interview as a dedicated case type ("Interview") linked to the application — not a generic appointment. Cúram tracks interview completion as a milestone on the application record with separate scheduling for the meeting. Neither conflates the regulatory requirement with the scheduling event.
- A generic `appointment` entity with `type: interview` in the scheduling domain would require scheduling to know about SNAP regulatory requirements — coupling scheduling to intake policy. Scheduling should not need to know that a particular appointment type satisfies a federal regulatory obligation.
- The scheduling domain does not reference back to `Interview` — the dependency is one-directional (intake → scheduling). Scheduling creates appointments without knowing whether they are tied to an interview.

**Options:**
- **(A)** Generic appointment with `type: interview` — no Interview entity in intake; scheduling domain owns the record; intake infers completion from scheduling events; couples scheduling to intake policy
- **(B)** ✓ Dedicated `Interview` entity in intake — intake owns the regulatory obligation; scheduling owns appointment mechanics; one-directional dependency (intake references scheduling appointment IDs); consistent with Pega and Cúram patterns

---

### Decision 11: External service verification write-backs

**Status:** Decided

**What's being decided:** When an external service call (e.g., FDSH citizenship check) completes, the result carries two distinct kinds of information: whether the verification obligation is satisfied (was the check conclusive?) and the verified fact (the confirmed citizenship status). These are different concerns: obligation status determines whether a document fallback is needed and belongs on the `Verification` checklist entry; verified facts are person attributes that eligibility will use for determination and belong on `ApplicationMember`. The question is how to split these on write-back — and whether any verification status belongs on `ApplicationMember` at all once `Verification` exists as a unified checklist entity.

**Considerations:**
- All federal external verification services operate per-person: fdsh_ssa checks citizenship and identity per SSN; fdsh_fti and ssa_ievs check income per SSN; fdsh_vlp and save check immigration status per person. None return household-level aggregate results.
- Writing the obligation outcome directly to `ApplicationMember` as a status field blends checklist management with member data. Once `Verification` exists as a unified checklist entity (see [Decision 9](#decision-9-verification-checklist-generation)), obligation status naturally belongs there, not as a separate field on `ApplicationMember`.
- Writing verified facts (confirmed income amount, confirmed citizenship status) to `ApplicationMember` is correct — those are person facts that belong on the member record and are used by the eligibility domain for determination.

**Decision:** Obligation status → `Verification`; verified facts → `ApplicationMember`. No verification status fields live on `ApplicationMember` — those belong on `Verification`.


---

### Decision 12: Data exchange orchestration

**Status:** Decided: Rules-engine-driven via createResource

**What's being decided:** Electronic verification service calls (FDSH, IEVS, SAVE) require intake's `ApplicationMember` data to be transformed into each service's specific request format. If data exchange handles that transformation, it must understand `ApplicationMember` schemas — coupling two domains that should be independent. If intake fires calls directly, it must know the data exchange API surface. The question is where the field mapping and service selection logic lives, and how to keep data exchange as a generic, domain-agnostic service while still giving it the correct payload for each member.

**Considerations:**
- Data exchange should not need to know about intake's data model — coupling domains makes each harder to evolve independently
- The rules engine already solves this pattern for workflow task creation and checklist generation; `createResource` with field mappings handles orchestration without a dedicated layer
- Defining the fan-out in intake rules makes it a contracted, auditable, state-customizable artifact; hidden in a data exchange adapter it would be opaque and un-overlayable

**Decision:** Intake rules create `data-exchange/service-calls` resources via `forEach` over the application's members, with member fields mapped into the service-specific request payload. Data exchange executes the call and emits a completion event. It has no knowledge of intake entities. The field mapping, service selection, and per-member fan-out live entirely in the rules contract, making them state-customizable.

---

### Decision 13: Unified Verification entity

**Status:** Decided: B

**What's being decided:** Verification at intake covers two types of obligations: electronic data source checks (FDSH, SAVE, IEVS) and requests for paper documents. For citizenship and immigration, these are two phases of the same obligation — ex parte rules require the electronic check first; a document can only be requested if the check is inconclusive. If electronic check results and document requests are tracked in separate structures, there's no single lifecycle covering both phases, caseworkers must consult two data structures to see the full verification state, and the two-phase ex parte flow can't be modeled as one obligation progressing through states. The question is whether to unify these into a single `Verification` entity.

**Considerations:**
- Pega, Salesforce PSS, and Cúram all converge on a unified verification entity covering both paper and electronic — the industry has settled this
- A split model (`ApplicationDocument` for paper + `ApplicationMember.verifications[]` for electronic) prevents a single lifecycle from applying to both types and forces caseworkers to consult two structures for one obligation

**Options:**
- **(A)** Separate entities — `ApplicationDocument` for paper requirements; `ApplicationMember.verifications[]` for electronic results; two structures, two query paths, no shared lifecycle
- **(B)** ✓ Unified `Verification` entity — single endpoint covers the full checklist; electronic and document evidence accumulate as sub-items on the same record; shared lifecycle applies to both

---

### Decision 14: Existing coverage check ownership

**Status:** Decided: B

**What's being decided:** Intake initiates electronic checks for facts applicants declare — citizenship, income, immigration status. If a check is inconclusive, the caseworker requests a supporting document from the applicant. The `Verification` checklist models this two-phase obligation. Existing coverage checks (Medicare enrollment via fdsh_medicare, employer-sponsored insurance via fdsh_vci) are different: the applicant does not declare existing coverage — the system proactively checks. If inconclusive, there is no document an applicant can provide and no caseworker action to take. The result is a determination input, not an applicant-facing obligation. The question is whether to model these checks as intake Verification entries (keeping all electronic checks in one domain) or as eligibility inputs (matching their actual purpose).

**Considerations:**
- The result informs the eligibility determination directly (existing coverage affects Medicaid eligibility) rather than resolving an applicant obligation. Caseworkers do not need to act on existing coverage results in intake — the outcome flows to the eligibility determination.
- Modeling existing coverage as an intake Verification would create a Verification with no document request path and no applicant-facing action, which is inconsistent with what the Verification checklist represents.

**Options:**
- **(A)** Intake initiates fdsh_medicare and fdsh_vci at submission, stores results as `existing_coverage` Verifications — keeps all electronic checks in one domain; but requires a Verification category with no applicant-facing resolution path
- **(B)** ✓ Eligibility initiates fdsh_medicare and fdsh_vci as part of its determination process — existing coverage is a determination input, not a verification obligation; intake has no `existing_coverage` Verification category; the results belong to eligibility's domain

---

### Decision 15: ApplicationMember composes from member.yaml

**Status:** Decided

**What's being decided:** `ApplicationMember` and the eligibility domain's `MemberContext` both describe the same person at different pipeline stages and share a substantial set of demographic fields. Without a shared base schema, these definitions are maintained independently and can drift: a field added to one must be manually added to the other to stay aligned. The question is whether `ApplicationMember` should duplicate those fields inline — accepting the drift risk — or compose from a shared `member.yaml` schema, making the alignment mechanically enforced.

**Considerations:**
- `allOf` composition makes the alignment mechanically enforced: fields added to `member.yaml` propagate to all consuming schemas automatically; the pattern is already established for `household.yaml`

---

### Decision 16: Review surface uses the composite view pattern

**Status:** Decided: B

**What's being decided:** The caseworker review surface needs a complete picture of the application in one place — members with demographics, income, expenses, assets, verification status, interview tracking, and notes — data spread across multiple sub-resources. Fetching it client-side requires sequential API calls and pushes assembly logic into every consumer. Fetching it server-side in one call is efficient, but if the endpoint prescribes a particular presentation structure (organized by program, by section, by verification status), it constrains how states can organize their review workflow. The decision is how to serve the complete application picture without prescribing how it should be displayed.

**Considerations:**
- Salesforce uses composite record page endpoints for case review surfaces; ServiceNow uses a neutral UI API; Cúram assembles case summary views server-side — the industry converges on server-side assembly with client-side presentation
- A display-organized endpoint prescribes one structure, constraining every consumer; client-side assembly multiplies round trips and duplicates assembly logic in every consumer

**Options:**
- **(A)** Display-organized endpoint — prescribes one review workflow; constrains all consumers
- **(B)** ✓ Server-assembled neutral composite (`GET /applications/{id}/review-context`) — all sub-resource data in one response; presentation is the front end's concern; writes still go through individual sub-resource endpoints; program-based and section-based views derived client-side
- **(C)** Client-assembled — maximum flexibility; multiplied round trips; assembly logic duplicated in every consumer

---

### Decision 17: Review-progress is a separate queryable resource

**Status:** Decided

**What's being decided:** As a caseworker moves through an application, they need to track completion status per section (household, income, verification, etc.) — navigation state that lets them resume where they left off and signals to supervisors which sections have been reviewed. This state needs to live somewhere in the data model. Adding it to the `Application` entity conflates application data with caseworker navigation; adding it to the workflow task conflates work assignment state with review progress. A dedicated resource keeps concerns separated but adds API surface area. The question is where per-section review status belongs.

**Considerations:**
- The application entity represents a benefit application; the workflow task represents a work assignment. Adding caseworker navigation state to either mixes concerns across resources with different owners and different state machines.
- Progress entries are bounded by `sections × members` — a small, stable dataset initialized at `under_review` transition. This makes full-dataset return without pagination practical, unlike open-ended resource collections.
- Review-progress is navigation state: it can be reset without consequence. Notes ([Decision 18](#decision-18-notes-are-a-first-class-resource)) must persist regardless of reset. Coupling them would cause notes to be lost on reset.

**Decision:** `ReviewProgressEntry` is a dedicated resource initialized at `submitted → under_review`. Status values (`not_started`, `in_progress`, `complete`, `flagged`) are navigation state only and overlay-extensible. Applicant-reported data is program-agnostic — program context is already on `ApplicationMember.programs`; no program dimension on review-progress.

---

### Decision 18: Notes are a first-class resource

**Status:** Decided

**What's being decided:** Caseworkers need to add narrative notes during review — interview observations, supervisor escalations, explanations of unusual income situations. Notes have different persistence requirements than review-progress: review-progress is navigation state that can be reset when application data changes; notes are audit documentation that must persist regardless of any reset. Notes also need to be queryable at multiple scoping levels — whole application, specific section, specific member — in ways that don't fit naturally on either the member entity or the review-progress resource. The question is whether to attach notes to an existing resource or treat them as a standalone resource with their own endpoint.

**Considerations:**
- Notes have authorship semantics states will want to extend — visibility controls, note types, use in external communications — which require independent addressability
- Cúram's case narrative system and Salesforce's Activity model both treat notes as a first-class resource, not a field on a process tracking object

**Decision:** Notes are a standalone resource (`GET /applications/{id}/notes`, `POST /applications/{id}/notes`). `additionalProperties: true` on `ApplicationNote` allows states to add note types or visibility controls via overlay without changing the baseline contract.

---

### Decision 19: Application submitted event payload — lean vs. enriched

**Status:** Decided: A

**What's being decided:** Whether `intake.application.submitted` should include full per-member program data — each member's demographics, income, and applied-for programs — so downstream consumers can act without querying Intake, or whether the payload should remain lean (`programs`, `memberIds` only) and consumers query Intake directly for detail they need.

**Considerations:**
- `intake.application.submitted` is consumed by many domains: workflow (task creation), eligibility (seeding Determination and Decisions), client management (person matching), communications (confirmation notice), data exchange (initiating checks). Adding per-member data grows the event schema significantly and couples every consumer to Intake's member data model.
- Changes to member fields (adding a field, renaming a property) would become breaking changes for all event consumers under the enriched approach, not just those that use the changed fields.
- Intake seeding Eligibility at submission reads member data directly from its own records — the seeding is a cross-domain write executed by Intake's submission handler, not driven by event consumers reading the event payload. Intake has direct access to its own records and does not need to embed them in the event. See [Eligibility Decision 12](eligibility.md#decision-12-who-creates-determination-and-decision-records).
- The lean payload (`programs`, `memberIds`) gives downstream domains enough to correlate and query what they need without embedding Intake's internal data model in a shared contract.

**Options:**
- **(A)** ✓ Keep the submitted event lean: `programs` (list of applied-for programs) and `memberIds` (list of household member IDs); Intake reads member data from its own records when seeding Eligibility
- **(B)** Enrich the submitted event with per-member program data so downstream consumers can act without querying Intake

---

## Customization

### Baseline constraints

| Element | Reason | Decision |
|---|---|---|
| `Application.submittedAt` | Regulatory clock anchor — SNAP 30-day and Medicaid 45-day processing deadlines are measured from this timestamp; removing it breaks SLA tracking | [Decision 4](#decision-4-intake-phase-end--lifecycle-state) |
| `Application.status` lifecycle states | Governs when data becomes immutable and when downstream domains (eligibility, case management) receive handoff events; removing states breaks cross-domain coordination | [Decision 4](#decision-4-intake-phase-end--lifecycle-state) |
| `ApplicationMember.role` | Determines authorized representative legal authority and non-applying member handling; required for regulated benefit unit composition | [Decision 1](#decision-1-role-vs-relationship-on-applicationmember) |
| `Verification.status` lifecycle | The verification checklist is a federal regulatory obligation (SNAP 7 CFR § 273.2(f)); removing status tracking collapses the ex parte and document-fallback resolution paths | [Decision 9](#decision-9-verification-checklist-generation) |
| `Interview.status` lifecycle | Tracks the SNAP interview regulatory obligation (7 CFR § 273.2(e)(1)); removing it makes the obligation untrackable | [Decision 10](#decision-10-interview-entity-model) |

### Note text format

`ApplicationNote.textFormat` accepts `plain`, `markdown`, or `html`. The baseline default is `plain`. States using a WYSIWYG note editor set `textFormat: html`; states using Markdown-native tooling set `textFormat: markdown`. No overlay change is needed — the field and all three values are present in the baseline. States that want to restrict the permitted formats can narrow the `textFormat` enum via overlay.

### Note attachments

The baseline `ApplicationNote` schema has no attachment support. States that need caseworkers to attach documents to notes have two approaches:

- **Reference-based** — add an `attachments` array to `ApplicationNote` via overlay, where each entry is a `documentId` referencing a record in the Document Management domain. The caseworker uploads the document first via the document management API, then includes the returned ID when creating or updating the note. No new intake endpoint is required.
- **Sub-resource** — add a `POST /applications/{applicationId}/notes/{noteId}/attachments` endpoint that accepts a multipart upload, proxies it to the document management domain, and appends the resulting document ID to `ApplicationNote.attachments`. More convenient for single-step UX but requires an additional endpoint and cross-domain adapter wiring.

The reference-based approach is consistent with how intake handles other document references (the `Verification` entity links to documents by ID rather than embedding them). The sub-resource approach trades simplicity for UX — appropriate when state portals want inline file attachment without a separate document upload step.

---

## Out of scope

The following are explicitly not intake domain concerns:

| Capability | Domain | Notes |
|---|---|---|
| Eligibility determination | Eligibility | The intake domain collects and structures data; it does not run eligibility rules or produce approved/denied outcomes |
| Recertification / renewal | Case Management | Triggered by an existing case nearing expiration, not a new applicant event |
| Notices and communications | Communication | The Communication domain subscribes to intake events (`application.submitted`, `application.withdrawn`) and sends notices; intake does not own notice generation |
| Document file storage and retrieval | Document Management | Intake owns verification obligation records (`Verification`); document management owns the actual file storage, retrieval, and retention lifecycle |
| Pre-screening / eligibility screening | Portal / UI layer | Pre-screening does not start the regulatory clock and is a portal concern; the intake domain lifecycle starts at application submission |
| Appointment scheduling mechanics | Scheduling | Intake owns the `Interview` entity (regulatory obligation); the scheduling domain owns appointments (time, location, confirmation, reminders). See [Decision 10](#decision-10-interview-entity-model). |
| TANF-specific intake | State overlay | Federal TANF requirements are minimal; TANF-specific intake customization is a state overlay concern. |
| Benefit delivery | Case Management | Created when eligibility is determined; owned by the case management domain |

---

## References

**Federal regulations:**
- [7 CFR § 273.2 — SNAP application processing](https://www.law.cornell.edu/cfr/text/7/273.2)
- [7 CFR § 273.1 — SNAP household definition](https://www.law.cornell.edu/cfr/text/7/273.1)
- [42 CFR § 435.912 — Medicaid application processing timelines](https://www.law.cornell.edu/cfr/text/42/435.912)
- [42 CFR Part 435 Subpart I — MAGI eligibility and household composition](https://www.law.cornell.edu/cfr/text/42/part-435/subpart-I)
- [CMS MAGI Conversion Methodology](https://www.medicaid.gov/medicaid/eligibility/downloads/magi-conversion-guide.pdf)

**Vendor documentation:**
- [IBM Cúram — Working with IEG](https://public.dhe.ibm.com/software/solutions/curam/6.0.4.0/en/Developers/WorkingWithCuramIntelligentEvidenceGathering.pdf)
- [IBM Cúram — Creating Datastore Schemas](https://public.dhe.ibm.com/software/solutions/curam/6.0.4.0/en/Developers/CreatingDatastoreSchemas.pdf)
- [Salesforce PSS — IndividualApplication object](https://developer.salesforce.com/docs/atlas.en-us.psc_api.meta/psc_api/sforce_api_objects_individualapplication.htm)
- [Salesforce PSS — PublicApplicationParticipant object](https://developer.salesforce.com/docs/atlas.en-us.psc_api.meta/psc_api/sforce_psc_api_objects_publicapplicationparticipant.htm)
- [Salesforce PSS — Benefit Management Data Model](https://developer.salesforce.com/docs/atlas.en-us.psc_api.meta/psc_api/psc_benefit_management_data_model.htm)
- [Pega Government Platform — Application Intake Features](https://docs.pega.com/bundle/pega-government-platform/page/pega-government-platform/product-overview/application_intake_features.html)
- [Pega — Household entity](https://docs.pega.com/pega-government-platform-85-implementation-guide/85/adding-field-existing-household-member-details)
- [CalSAWS — BenefitsCal API for IRT](https://www.calsaws.org/wp-content/uploads/2022/03/CA-235841-BenefitsCal-API-for-IRT.pdf)

**Open source and federal API references:**
- [HHSIDEAlab/medicaid_eligibility — MAGI-in-the-Cloud](https://github.com/HHSIDEAlab/medicaid_eligibility)
- [18F/snap-api-prototype](https://github.com/18F/snap-api-prototype)
- [CMS Marketplace API](https://developer.cms.gov/marketplace-api)

**Standards:**
- [CloudEvents 1.0 specification](https://cloudevents.io/)
