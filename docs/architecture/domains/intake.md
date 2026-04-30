# Intake Domain: Design Reference

Industry research and design decisions for the intake domain, covering process, regulations, data model, events, and lifecycle. Informed by how major government benefits platforms implement intake for SNAP, Medicaid, TANF, and WIC, and by the federal regulations that govern each program.

See [Intake Domain](intake.md) for the architecture overview and [Contract-Driven Architecture](../contract-driven-architecture.md) for the contract approach.

**Systems compared:** IBM Cúram (Merative), Salesforce Public Sector Solutions, Pega Government Platform, CalSAWS/BenefitsCal, MAGI-in-the-Cloud (HHS), 18F SNAP API prototype, CMS Marketplace API, WIC MIS systems (HANDS, Crossroads) and the FNS FReD functional reference

**Regulatory standards referenced:** 7 CFR Part 273 (SNAP), 42 CFR Part 435 (Medicaid/MAGI), 45 CFR Part 246 (WIC), 45 CFR Part 261 (TANF), ACA/MAGI household composition rules

> **Note on WIC:** WIC uses the term "certification" rather than "application." It is a clinical eligibility determination requiring a Competent Professional Authority (CPA) to assess nutritional risk. There is no federal processing deadline equivalent to SNAP's 30 days. WIC has no single dominant platform: states build or procure their own Management Information Systems (MIS). FNS publishes the **FReD** (Functional Requirements Document for a Model WIC System) as the functional reference — it is a requirements document, not a software product.

> **Note on recertification:** Recertification is triggered by an existing case nearing expiration, not by a new applicant. It belongs in the Case Management domain, not Intake. It is noted in [Out of scope](#out-of-scope) with a pointer to where it will be designed.

---

## Overview

The intake domain is responsible for capturing and structuring the data a household submits when applying for benefits. It does not determine eligibility, manage ongoing cases, or deliver benefits — those are downstream domain concerns. The intake phase begins when an application is filed (starting the regulatory clock) and ends when the application data is complete enough to submit for eligibility determination — after data collection is finished (interviews conducted, documents received, verification complete), not when the applicant first clicks submit. This boundary follows the regulatory processing clock (7 CFR § 273.2, 42 CFR § 435.912), which starts at filing and runs until determination regardless of who collects the data — federal regulations make no distinction between client-submitted and caseworker-entered data for purposes of defining the application processing period.

**Entities owned by this domain:**

- **Application** — the root record representing one submission by a household
- **ApplicationMember** — a person linked to the application (applying or counted in household)
- **Verification** — a unified checklist record covering paper document requirements and electronic service check results
- Income, expenses, and assets — financial facts collected per person or household

**What this domain produces:** a structured, verified data record that downstream domains (eligibility, workflow, case management) can act on.

All major platforms draw a hard boundary between the intake phase and the case management phase — the blueprint follows the same pattern: the intake domain owns the application record; eligibility and case management own what happens after.

---

## What happens during intake

The intake phase spans from filing through caseworker review and data collection. The key activities and their sequence:

1. **Filing** — applicant submits a minimally complete application; regulatory clock starts; the application enters the caseworker queue for review covering all programs applied for
2. **Confirmation notice** — the agency sends an acknowledgment to the household confirming receipt of the application and the filing date; many states are required to provide this notice
3. **Identity matching** — the agency attempts to match the applicant and household members to existing person records to prevent duplicate records and link to prior application history; see [Decision 10](#decision-10-person-identity-matching)
4. **Queue assignment and routing** — the application is routed to the appropriate caseworker based on program type, geography, workload, or other agency-configured rules
5. **Automated eligibility determination (Medicaid)** — for MAGI Medicaid, the agency immediately attempts real-time eligibility (RTE) via the Federal Data Services Hub (FDSH) using SSA income data, IRS tax data, and citizenship/immigration status; if RTE succeeds, Medicaid is auto-approved or auto-denied with no caseworker involvement; if inconclusive, Medicaid proceeds to caseworker review; this runs before any caseworker action (45 CFR § 435.911–435.916)
6. **Electronic data source checks** — in parallel with or shortly after filing, the agency queries electronic data sources to pre-populate or verify applicant-reported data: IEVS/The Work Number for income and employment, SAVE for immigration and citizenship status, SSA for disability and benefit receipt; results inform the caseworker's review but do not replace it
7. **Expedited screening** — for SNAP, the caseworker must determine within 1 business day whether the household qualifies for expedited processing (7-day track)
8. **Caseworker review and data correction** — the caseworker reviews what the applicant submitted for accuracy and completeness; the caseworker may update, add, or correct application data on behalf of the household based on what they learn during the interview and document review
9. **Interview** — SNAP requires an interview at initial certification; some states waive this for renewals or specific populations; information gathered in the interview may result in updates to the application data (steps 8 and 9 are often interleaved)
10. **Document collection and verification** — the caseworker requests supporting documents; the applicant has at least 10 days to provide them (SNAP); documents may trigger further data corrections
11. **Data completion** — once the caseworker is satisfied that the application data is accurate and complete, the application is ready for eligibility determination; this is when the intake phase ends

**What intake does not cover:** eligibility rules, approval/denial decisions, and service delivery case creation. Those are downstream domain concerns.

---

## Regulatory requirements

### Processing clocks

Federal law sets maximum processing timelines that begin at application receipt — not when a caseworker picks up the application. The clock starts at filing regardless of how long it takes to assign the application to a worker.

**SNAP (7 CFR § 273.2):** The 30-day processing clock starts on the *date of application receipt* — the date the household submits a minimally complete application (name, address, signature). For online applications submitted after hours, the filing date is the next business day. States must process within 30 days (7 days for expedited households).

**Medicaid (42 CFR § 435.912):** The 45-day clock (90 days for disability-based Medicaid) starts on the application receipt date.

**WIC (45 CFR Part 246):** No federal processing deadline. Certification period varies by participant category (see Out of scope).

### Program-specific requirements

**SNAP (7 CFR § 273.2):**
- Caseworker interview required before determination (§ 273.2(e)) — cannot be waived for initial certification
- Expedited screening must occur within 1 business day for households that may qualify for the 7-day track (§ 273.2(i))
- Applicant has at least 10 days to provide requested verification documents (§ 273.2(f))
- All household members must be listed regardless of whether they are individually applying (§ 273.1)

**Medicaid/MAGI (45 CFR § 435.911–435.916):**
- States must attempt automated real-time eligibility determination via FDSH before routing to a caseworker (§ 435.911)
- If RTE is inconclusive or unavailable, the application routes to a caseworker for manual review
- No caseworker interview is federally required for Medicaid (unlike SNAP)

**TANF (45 CFR Part 261):**
- Federal requirements are minimal; states have broad discretion over intake procedures
- No federal automated determination requirement; no prescribed interview structure

---

## Entity model

### Application

The root entity representing one submitted application from a household. All major platforms have an equivalent concept — an application-scoped record that is distinct from the downstream case or benefit assignment. No platform tracks the final determination (approved/denied) on the application itself; that lives on the program delivery case created after eligibility determination.

**Key fields:** `id`, `status`, `programs`, `channel`, `submittedAt`, `withdrawnAt`, `closedAt`, `createdAt`, `updatedAt`

See [Decision 2](#decision-2-programs-applied-for--placement), [Decision 4](#decision-4-authorized-representative--modeling), [Decision 6](#decision-6-intake-phase-end--lifecycle-state).

---

### ApplicationMember

A person linked to an application. May be the primary applicant, a household member applying for benefits, a household member counted but not applying, or an authorized representative. All major platforms have an equivalent member/participant record linked to the application.

SNAP requires all household members to be listed regardless of whether they are individually applying (7 CFR § 273.1).

**Key fields:** `firstName`, `lastName`, `dateOfBirth`, `sex`, `SSN`, `relationship`, `roles`, `programsApplyingFor`, `resolvedPersonId`

See [Decision 1](#decision-1-role-vs-relationship-on-applicationmember), [Decision 2](#decision-2-programs-applied-for--placement), [Decision 4](#decision-4-authorized-representative--modeling), [Decision 10](#decision-10-person-identity-matching).

---

### Program-specific eligibility attributes

Facts about a household member relevant to eligibility determination — citizenship status, immigration status, pregnancy, student status, disability, tax filing status. All are flat fields on `ApplicationMember`. See [Decision 3](#decision-3-program-specific-eligibility-attributes--structure).

**Tax filing status (MAGI Medicaid):** MAGI Medicaid determines eligibility based on tax filing status and dependency relationships, not physical household membership. This requires fields not needed for SNAP-only applications: `taxFilingStatus`, `claimedAsDependentBy`, `expectToFileTaxes`, `marriedFilingJointly`. See [Decision 12](#decision-12-magi-tax-filing-status-fields).

---

### Income, expenses, and assets

Financial facts collected to support eligibility determination.

- **Income**: per-person, by source (employment, self-employment, Social Security, SSI, TANF, child support, etc.) with `amount`, `frequency`, `startDate`, optionally `employer`
- **Expenses**: household-level for shelter and utilities; per-person for child care, medical (elderly/disabled), court-ordered child support paid
- **Assets**: per-person, by type (bank account, vehicle, real property, life insurance) with `amount` and `description`

See [Decision 11](#decision-11-income-and-expense-detail-at-intake).

---

### Verification

A unified record representing one item on the household's verification checklist — covering both paper document requirements (e.g., provide a pay stub) and electronic service check results (e.g., an FDSH citizenship check). All major platforms converge on a unified verification concept that covers both types. See [Decision 19](#decision-19-unified-verification-entity) for the choice.

Verification records are created by the rules engine in response to intake events, not manually by caseworkers under normal circumstances. Household-level obligations (e.g., proof of residency) are linked to the application only. Member-level obligations (e.g., proof of income, citizenship) are linked to both the application and the specific member.

**Key fields:** `id`, `applicationId`, `memberId` (nullable — null for household-level obligations), `verificationType` (`document` | `electronic`), `category` (`citizenship`, `income`, `identity`, `residency`, `immigration`, etc.), `status` (`pending` | `inconclusive` | `satisfied` | `waived` | `cannot_verify`), `source` (for electronic: `fdsh` | `ievs` | `save` | `ssa`), `evidence` (for document: IDs of verified documents from document management), `createdAt`, `updatedAt`

See [Decision 14](#decision-14-verification-checklist-generation), [Decision 19](#decision-19-unified-verification-entity).

---

### Interview

A regulatory tracking entity representing the required SNAP interview obligation for an application. Distinct from individual appointments — one interview requirement may involve multiple appointments due to rescheduling or no-shows. The caseworker attests which appointment satisfied the interview obligation by setting `completedAt`.

Intake owns this entity because the obligation is regulatory (7 CFR § 273.2(e)) and tied to the application lifecycle. The scheduling domain owns the appointment mechanics (time, location, confirmation, reminders). Intake tracks whether the regulatory requirement is satisfied, not the scheduling details.

**Key fields:** `id`, `applicationId`, `appointments` (array of appointmentIds from the scheduling domain — one-to-many to accommodate reschedules), `waiverGranted`, `waiverReason`, `completedAt`

**Linkage constraint:** The `scheduling.appointment.scheduled` subscription can link an appointment to the correct Interview only when the caseworker schedules from within the application context, so the scheduling system can populate `subjectType: interview` and `subjectId: {interviewId}` on the appointment automatically. Scheduling from a standalone module without that context produces an unlinked appointment.

See [Decision 15](#decision-15-interview-entity-model), [Decision 16](#decision-16-interview-task-creation-timing).

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

**Implication for the data model:** Application data is mutable during `under_review`. The intake domain must support caseworker-initiated updates to application records, not just the applicant's initial submission. This has audit trail implications — changes made by caseworkers after submission should be distinguishable from the original submitted data. See [Decision 7](#decision-7-application-data-mutability-and-audit-trail).

### Key transitions

- **submit**: `draft` → `submitted` — applicant files; regulatory clock starts; triggers caseworker task creation and confirmation notice
- **open**: `submitted` → `under_review` — caseworker begins actively reviewing the application; assignment may happen separately and does not necessarily trigger this transition; see [Decision 8](#decision-8-submitted--under_review-transition-trigger)
- **withdraw**: `submitted` | `under_review` → `withdrawn` — applicant-initiated; triggers open task cancellation
- **close**: `under_review` → `closed` — caseworker signals the application is ready for eligibility determination; see [Decision 6](#decision-6-intake-phase-end--lifecycle-state)

---

## Domain events

See [`docs/architecture/diagrams/intake-flow.mmd`](../diagrams/intake-flow.mmd) for a sequence diagram of the full intake flow across all domains.

### Event types

The intake domain emits two kinds of events:

**Lifecycle transition events** — named, semantic events tied to application state changes or significant caseworker actions (e.g., submission, withdrawal, expedited flag). Each carries a specific payload relevant to the transition.

**Generic resource events** — emitted on any create, update, or delete of the application or its sub-resources. These support audit and change-tracking consumers without requiring a named event for every data change. Sub-resource-level events are addressed when those sub-resources are designed. See [Decision 5](#decision-5-domain-events--scope).

### Event catalog

Events are listed with the operational or regulatory need that drives them — the reason a downstream domain needs to react, not just what happens to trigger them.

| Event | Why it's needed | Trigger | Primary consumers |
|---|---|---|---|
| `application.submitted` | Submission starts the regulatory clock (SNAP 30-day, Medicaid 45-day). Downstream domains cannot begin work until they know an application has been filed and when. See [Decision 13](#decision-13-post-submission-program-routing--task-creation-and-automated-eligibility) for how routing differs by program. | `draft` → `submitted` | Workflow, Communication (confirmation notice), Eligibility (automated determination for applicable programs) |
| `application.opened` | Signals that a caseworker has begun active review. Workflow needs to update the task state; supervisors tracking queue throughput need to know when review started vs. when it was filed. | `submitted` → `under_review` | Workflow (update task to in_progress) |
| `application.expedited_flagged` | SNAP requires a determination within 7 days for expedited households. The workflow domain needs to immediately escalate to a higher-priority SLA track — the standard 30-day task SLA is wrong for these cases. This is a named trigger effect, not a generic field update. | `flag-expedited` trigger | Workflow (escalate to expedited SLA) |
| `application.withdrawn` | A withdrawn application must stop all in-flight processing immediately. Open workflow tasks must be cancelled; any scheduled interview or document request must be voided; communication must notify the household. Failing to act on this event risks processing an application the household has abandoned. | any → `withdrawn` | Workflow (cancel open tasks), Communication (withdrawal notice) |
| `application.closed` | Signals that intake is complete and the application is ready for or has received an eligibility determination. Case Management needs this event to know when to create a service delivery case (if approved). Without it, case management has no trigger to act. | `under_review` → `closed` | Case Management (create case if approved), Eligibility |
| `application.review_completed` | Caseworker signals that data collection is complete and the application is ready for eligibility determination. No state change — application stays `under_review` until intake receives eligibility outcomes and closes itself. Eligibility needs this event to know when to begin determination; without it, eligibility has no trigger distinct from submission. | `complete-review` trigger (no state change) | Eligibility |

### Event subscriptions

Events from other domains that intake reacts to:

| Event | Why intake subscribes | Action |
|---|---|---|
| `workflow.task.claimed` | A caseworker claiming the intake review task signals they have begun active review — intake should reflect this in the application lifecycle. See [Decision 8](#decision-8-submitted--under_review-transition-trigger). | Trigger `submitted → under_review` on the linked application |
| `eligibility.determination_complete` | Eligibility publishes outcomes per program; intake subscribes to determine when all programs are resolved and the application can be closed. See [Decision 6](#decision-6-intake-phase-end--lifecycle-state). | Trigger `close` when all programs are determined |
| `data-exchange.service-call.completed` | Ex parte rules require electronic verification before requesting paper documents. When an external service call returns a result, the rules engine updates the affected `Verification` status — satisfied if verified, or creating a conditional document-based obligation if inconclusive. See [Decision 14](#decision-14-verification-checklist-generation), [Decision 17](#decision-17-external-service-verification-write-backs), [Decision 18](#decision-18-data-exchange-orchestration). | Rules engine updates `Verification` status; creates document-based `Verification` if inconclusive |
| `scheduling.appointment.scheduled` | Intake must link each scheduled appointment to the correct Interview entity so the appointments array stays current. Required for caseworkers to see appointment history and for the interview completion flow to be traceable. See [Decision 15](#decision-15-interview-entity-model). | Rules engine appends the appointmentId to `Interview.appointments` for the linked interview |
| `document-management.document.verified` | When a submitted document is reviewed and accepted, the corresponding verification obligation is satisfied. Without this event, intake has no trigger to mark the `Verification` as satisfied when the caseworker completes document review. | Rules engine transitions the matching `Verification` record to `satisfied` and records the document ID in its `evidence` list |

---

## Key design decisions

Quick reference — each decision is detailed in the section below.

| # | Decision | Summary |
|---|---|---|
| 1 | [Role vs. relationship on ApplicationMember](#decision-1-role-vs-relationship-on-applicationmember) | Separate `role` and `relationship` fields — no vendor conflates them. |
| 2 | [Programs applied for — placement](#decision-2-programs-applied-for--placement) | Both application-level and member-level programs lists. |
| 3 | [Program-specific eligibility attributes — structure](#decision-3-program-specific-eligibility-attributes--structure) | Flat facts on ApplicationMember — person facts don't change per program. |
| 4 | [Authorized representative — modeling](#decision-4-authorized-representative--modeling) | `roles` array on ApplicationMember — supports multiple simultaneous roles. |
| 5 | [Domain events — scope](#decision-5-domain-events--scope) | Both lifecycle and resource events; specific events determined per-domain. |
| 6 | [Intake phase end — lifecycle state](#decision-6-intake-phase-end--lifecycle-state) | Caseworker-triggered event, no new state — each domain owns its own transitions. |
| 7 | [Application data mutability and audit trail](#decision-7-application-data-mutability-and-audit-trail) | Cross-cutting audit domain — audit logic lives once, not duplicated per domain. |
| 8 | [submitted → under_review transition trigger](#decision-8-submitted--under_review-transition-trigger) | Intake subscribes to `task.claimed` — one caseworker action triggers both domains. |
| 9 | [Member-to-member relationship matrix (MAGI)](#decision-9-member-to-member-relationship-matrix-magi) | Relationship to primary applicant only — sufficient for SNAP and most MAGI cases; full pairwise matrix is a known gap. |
| 10 | [Person identity matching](#decision-10-person-identity-matching) | Matching triggered at submission; synchronous vs. asynchronous is an implementation choice. |
| 11 | [Income and expense detail at intake](#decision-11-income-and-expense-detail-at-intake) | Full schema, only gross income required — implementations decide how much detail to collect. |
| 12 | [MAGI tax filing status fields](#decision-12-magi-tax-filing-status-fields) | Flat fields in the baseline — required by the MAGI household composition logic from [Decision 9](#decision-9-member-to-member-relationship-matrix-magi). |
| 13 | [Post-submission program routing — task creation and automated eligibility](#decision-13-post-submission-program-routing--task-creation-and-automated-eligibility) | One intake task per application with per-program status — programs under automated processing marked at task creation. |
| 14 | [Verification checklist generation](#decision-14-verification-checklist-generation) | Rules-driven `Verification` records cover both paper document requirements and electronic check obligations. |
| 15 | [Interview entity model](#decision-15-interview-entity-model) | Dedicated Interview entity in intake — not a generic appointment type; scheduling owns mechanics, intake owns regulatory tracking. |
| 16 | [Interview task creation timing](#decision-16-interview-task-creation-timing) | Interview task created at task claim time (when caseworker is known), not at submission. |
| 17 | [External service verification write-backs](#decision-17-external-service-verification-write-backs) | Obligation status → `Verification` record; verified facts → `ApplicationMember` fields. |
| 18 | [Data exchange orchestration](#decision-18-data-exchange-orchestration) | Intake rules create `data-exchange/service-calls` resources — data exchange stays generic; field mapping lives in rules. |
| 19 | [Unified Verification entity](#decision-19-unified-verification-entity) | Single `Verification` entity with `verificationType` replaces `ApplicationDocument` and `ApplicationMember.verifications[]`. |

---

### Decision 1: Role vs. relationship on ApplicationMember

**Status:** Decided: B

**What's being decided:** Whether the member's role in the application process (primary applicant, household member, authorized representative) and their family relationship to the primary applicant (spouse, child, parent) are one field or two.

**Considerations:**
- No major vendor conflates these — Cúram, Salesforce, and Pega all have separate fields for application-process role and family relationship
- An authorized representative may also be a family member — a single field can't represent both accurately
- A non-applying household member has no meaningful application-process role but does have a family relationship that matters for MAGI Medicaid tax-household composition

**Options:**
- **(A)** Single `relationship` field encoding both application role and family relationship
- **(B)** ✓ Separate `role` field (application process role: primary_applicant, household_member, non_applying_member, authorized_representative, absent_parent) and `relationship` field (family relationship to primary applicant: spouse, child, parent, etc.). Note: [Decision 4](#decision-4-authorized-representative--modeling) extends this to a `roles` array to support multiple simultaneous roles.

---

### Decision 2: Programs applied for — placement

**Status:** Decided: C

**What's being decided:** Where in the data model to track which programs are being applied for — at the application level, the member level, or both.

**Considerations:**
- All major vendors track programs at the application level (a list of which programs the household is applying for) — this part is universal
- Per-member, per-program tracking is less standardized: Cúram and CalSAWS use a simple `isApplyingForBenefit` boolean on the member; Pega pushes the distinction entirely to the eligibility rules engine
- Vendors that rely on the eligibility engine to infer per-member intent can exclude ineligible members using rules, but have no way to distinguish an ineligible member from a member who voluntarily opted out of a program — that distinction is lost at intake
- Regulation requires per-member clarity: Medicaid determines eligibility individually per member; SNAP allows individual member exclusions even within the same household; WIC is fully individual certification
- Tracking at both levels requires consistency validation — a member can't be applying for a program that isn't on the application's programs list; this is a UI/API concern, not a data model flaw

**Options:**
- **(A)** Application level only — one programs list on Application, member-level distinction inferred downstream
- **(B)** Member level only — each ApplicationMember has a `programsApplyingFor` list; application-level programs list derived from member data
- **(C)** ✓ Both — Application has a programs list (screening/routing flag — which programs the household intends to apply for, used at submission for queue routing, expedited screening, and automated eligibility triggering), ApplicationMember has a `programsApplyingFor` list (individual intent — which members are applying for which programs); eligibility determination operates at the member level via `programsApplyingFor`; makes voluntary non-application explicit; gives eligibility a clean input

---

### Decision 3: Program-specific eligibility attributes — structure

**Status:** Decided: A

**What's being decided:** Whether eligibility-relevant attributes (citizenship, immigration status, pregnancy, student status, disability) are flat fields on ApplicationMember or nested inside a per-program structure.

**Considerations:**
- No major vendor nests eligibility attributes per-program at intake — Cúram, Pega, MAGI-in-the-Cloud, CMS Marketplace, and CalSAWS all use flat facts on the member entity
- These are facts about the person, not the program: citizenship status doesn't change depending on which program is being applied for; the same fact is evaluated independently by each program's rules
- Per-program nesting would duplicate data (same citizenship status entered once per program) and complicate data entry
- The one genuinely per-program attribute is which programs the member is applying for — handled separately in [Decision 2](#decision-2-programs-applied-for--placement)

**Options:**
- **(A)** ✓ Flat on ApplicationMember — citizenship, immigration status, pregnancy, student status, disability as direct fields; consistent with all major vendors
- **(B)** Per-program nested — each program entry on the member has its own sub-object with program-specific fields
- **(C)** Hybrid — flat for shared person facts, per-program only for attributes that are genuinely program-specific (e.g., work registration exemption reason, which has different rules per program)

---

### Decision 4: Authorized representative — modeling

**Status:** Decided: C

**What's being decided:** Whether the authorized representative is a role on an ApplicationMember record or a separate reference from the Application entity.

**Considerations:**
- Salesforce and Cúram both model the authorized representative as a role on the member junction record — no separate entity. Pega uses a separate reference from the Application to a person record.
- SNAP regulations (7 CFR § 273.2(n)) require the authorized representative to be a non-household-member — modeling them as a single role on `ApplicationMember` is conceptually imprecise: they are not a member
- Medicaid (42 CFR § 435.923) is less restrictive — a household member could act as authorized representative for Medicaid purposes, meaning the same person legitimately holds two roles
- A `roles` array resolves both: a SNAP authorized rep is an ApplicationMember with `roles: [authorized_representative]` only; a Medicaid authorized rep who lives in the household has `roles: [household_member, authorized_representative]`

**Options:**
- **(A)** Single `role` value on ApplicationMember (`role: authorized_representative`) — consistent with Salesforce and Cúram; simpler; conceptually imprecise for SNAP
- **(B)** Separate reference on Application pointing to a person record — consistent with Pega; accurate for SNAP's non-household-member requirement; adds a separate relationship to manage
- **(C)** ✓ `roles` array on ApplicationMember — keeps the authorized rep as a member record (no separate entity); allows multiple simultaneous roles; accurately represents both SNAP (non-household-member has no `household_member` role) and Medicaid (household member can hold both roles)

---

### Decision 5: Domain events — scope

**Status:** Decided: publish as needed

**What's being decided:** Whether to limit events to lifecycle state transitions or also publish events for significant data changes within a stable state.

**Considerations:**
- Salesforce CDC automatically publishes externally accessible change events for any enabled object via the Pub/Sub API — a genuine CDC subscription model. Cúram and Pega both require explicit developer instrumentation per event (outbound SOAP calls or Kafka publish steps wired into flows); they do not offer automatic data mutation event streams.
- Transition events have stable, minimal payloads. Data mutation events carry more model detail and require more care to evolve.
- The main governance concern with data mutation events is **semantic coupling**: consumers depend on the event payload shape; renaming or restructuring fields is a breaking change. Mitigations: additive-only payload evolution, event type versioning (`v1`/`v2`), a schema registry, consumer-driven contract testing, or defining event schemas using the same canonical types as the API specs (already overlayable in the blueprint).
- Adding a new event type is additive and non-breaking — events can be introduced per-domain as integration needs emerge, without a blanket upfront decision.

**Decision:** Both transition and data mutation events are supported. Which specific events to emit is determined per-domain based on real integration needs, governed by the schema evolution practices above.

---

### Decision 6: Intake phase end — lifecycle state

**Status:** Decided: C

**What's being decided:** Whether the caseworker's completion of intake review is signaled by a lifecycle state change, a domain event, or not at all — and how the application record reaches its terminal state without coupling intake to the eligibility domain.

**Considerations:**

Regulatory factors:
- Federal processing clocks (30 days for SNAP, 45 days for Medicaid) start at **submission**, not at "intake complete" — neither option creates a compliance problem on its own
- SNAP requires an interview before determination (7 CFR § 273.2(e)); the interview is part of intake — the caseworker's completion signal is a natural point to record that the interview occurred
- Federal quality control reviews (SNAP, Medicaid) audit application processing timeliness; a clean timestamp for when the caseworker considered intake complete aids QC reporting
- SNAP expedited screening (7 CFR § 273.2(i)) runs on a 7-day clock starting at submission — it proceeds during intake, not after, so it doesn't conflict with any of these options

Domain ownership:
- Each domain should own its own state transitions. Having the eligibility domain directly close the application creates coupling — intake's lifecycle would be controlled by another domain.
- The cleaner model: intake subscribes to eligibility events and decides when the application is done based on its own logic (e.g., all programs determined → `closed`). Eligibility publishes what it knows; intake decides what "done" means.
- A `pending_determination` state implies eligibility can't begin until intake signals it's ready — but eligibility could reasonably begin earlier for some programs, and expedited screening already does

Arguments for an explicit state (`pending_determination`):
- Adds a transition to manage and a caseworker step; creates multi-program ambiguity (complete for SNAP but still awaiting Medicaid verification?)

Arguments for a caseworker-triggered event with no new state:
- The caseworker's completion is a meaningful signal regardless of what the application's lifecycle state is; downstream systems subscribe if relevant
- No new state to manage; the application stays `under_review` until intake's own logic closes it based on eligibility events received

**Options:**
- **(A)** No explicit signal — application moves to `closed` when intake's logic determines all programs are resolved; fluid boundary similar to Cúram
- **(B)** Explicit `pending_determination` state — caseworker transitions the application; intake emits `application.review_completed`; adds a state and a step
- **(C)** ✓ Caseworker-triggered event, no new state — caseworker action emits `application.review_completed` while the application stays `under_review`; intake subscribes to eligibility events and closes the application when all programs are determined; each domain owns its own state transitions

---

### Decision 7: Application data mutability and audit trail

**Status:** Decided: C

**What's being decided:** How changes to application data made by caseworkers during `under_review` are tracked — and whether the intake domain owns the audit trail or delegates it.

**Considerations:**
- All major vendors implement audit internally — Cúram versions each evidence update; Pega's case audit framework captures who changed what and when; Salesforce uses field history tracking. None delegate to a separate audit domain, but all are monolithic systems where the concept doesn't exist. The blueprint's domain separation creates the opportunity to do this differently.
- Application data at determination may differ materially from the applicant's original submission — caseworkers correct entries from the interview, reconcile documents, and add information the applicant couldn't provide; SNAP regulations require documentation of how eligibility was determined
- Caseworkers need to see version history for an application — which option is chosen determines where that history lives and how it's queried
- **Option A/B (audit in intake domain)**: Each domain with mutable data would independently implement audit logic — duplicated across intake, case management, eligibility, etc.
- **Option C (cross-cutting audit domain)**: Audit logic lives once; all domains get the same treatment; cross-domain queries ("all changes by this caseworker this week") are possible from one place; intake stays focused on capturing application data. Requires mutation events to carry enough payload to reconstruct version history — either the full record at each point (fat events, easy to compare) or changed fields with before/after values (thin events, smaller payloads, audit domain reconstructs state by replaying). Either approach is established; Salesforce CDC uses the thin approach.

**Options:**
- **(A)** Field-level change tracking in intake — each update records who changed what field, from what value; intake owns the audit trail; duplicated in every other domain that needs auditing
- **(B)** Version snapshots in intake — each caseworker save creates a full record snapshot; simpler than field-level but coarser; still duplicated across domains
- **(C)** ✓ Cross-cutting audit domain — intake emits mutation events; a dedicated audit domain subscribes and maintains version history across all domains; caseworker history views draw from the audit domain; intake stays simple

---

### Decision 8: submitted → under_review transition trigger

**Status:** Decided: B

**What's being decided:** Whether the `submitted → under_review` transition is triggered by an explicit intake domain action or by intake subscribing to the workflow domain's `task.claimed` event.

**Considerations:**
- All major vendors handle this within a single system — the intake/case system and the task/workflow system are one; the cross-domain question doesn't arise. The blueprint separates them.
- The event-driven approach is consistent with [Decision 6](#decision-6-intake-phase-end--lifecycle-state): intake owns its own state transitions but reacts to events from other domains. Subscribing to `task.claimed` is not tight coupling — intake still decides to transition itself; the event is the trigger.
- The explicit-action approach requires the caseworker (or the UI) to make two calls — claim the task in workflow, then separately open the application in intake. The event-driven approach reduces this to one caseworker action.
- Assignment (routing to a queue) and opening (caseworker begins review) may be two distinct moments — the task `claim` event maps to opening, not just assignment

**Options:**
- **(A)** Explicit intake action — caseworker calls the intake domain API to open the application; intake owns the state change; requires an extra step
- **(B)** ✓ Intake subscribes to `task.claimed` — intake reacts to the workflow event and transitions the application to `under_review`; one caseworker action; consistent with the event-driven pattern established in Decision 7

---

### Decision 9: Member-to-member relationship matrix (MAGI)

**Status:** Decided: A

**What's being decided:** Whether the data model captures relationships between any two household members or only the relationship of each member to the primary applicant.

**Considerations:**
- Cúram and MAGI-in-the-Cloud both capture full pairwise relationships between any two members. Pega and CalSAWS capture only relationship to the head/primary applicant.
- MAGI household composition is determined by tax filing relationships, not physical co-habitation. The critical inputs are: who files taxes, who is claimed as a dependent by whom (`claimedAsDependentBy`), and who files jointly (spouse relationship). These fields cover the vast majority of MAGI household composition cases without a pairwise matrix.
- The remaining gap: if a child has no `claimedAsDependentBy` set (not claimed by anyone) but has a non-primary parent in the household, MAGI rules require counting the child in that parent's household — but Option A doesn't capture that parent-child relationship explicitly. States implementing MAGI who encounter this edge case would need to extend the schema with a pairwise relationship entity.
- A pairwise matrix grows in complexity with household size (N×(N-1) directed pairs); most intake forms guide applicants through dependency questions in a way that populates `claimedAsDependentBy` correctly anyway
- A relationship-to-primary field is sufficient for SNAP (SNAP uses physical co-habitation, not tax relationships)

**Known gap:** The baseline does not support the edge case where a non-primary adult is the parent of a household child who is not claimed as a tax dependent by anyone. States needing to handle this must extend the schema with a pairwise member relationship entity.

**Options:**
- **(A)** ✓ Relationship to primary applicant only — `relationship` field on ApplicationMember; sufficient for SNAP and most MAGI cases when combined with `claimedAsDependentBy` and tax filing status fields; lean baseline
- **(B)** Full pairwise relationship matrix — separate relationship entity; covers all MAGI edge cases; consistent with Cúram and MAGI-in-the-Cloud; adds complexity for all states including those not implementing Medicaid

---

### Decision 10: Person identity matching

**Status:** Decided

**What's being decided:** Whether identity matching is part of intake's contract and when it is triggered.

**Considerations:**
- Without matching, the same person applying multiple times creates duplicate records leading to data quality problems and incorrect eligibility determinations — matching is necessary
- All major vendors match within the same system; Cúram creates unresolved `PROSPECTPERSON` records at submission and resolves them afterward; Salesforce and Pega match at record creation
- The contract is the same regardless of whether the implementation matches synchronously (during the submission request) or asynchronously (after); the field exists and gets populated either way — timing is an implementation choice
- Triggering at submission is the right moment: the caseworker should see prior history when they open the application for review; deferring to eligibility loses that context

**Decision:** Identity matching is triggered at submission. `ApplicationMember` carries a nullable `resolvedPersonId` field populated by the matching process. Whether the implementation calls the identity service synchronously or asynchronously is left to the implementor.

---

### Decision 11: Income and expense detail at intake

**Status:** Decided: D

**What's being decided:** Whether the intake form collects full income and expense detail or a summary that is refined during caseworker review.

**Considerations:**
- Full-featured intake systems (CalSAWS, Cúram, Pega) collect full line-item income detail. Simplified portals like GetCalFresh (Code for America) collect totals only, prioritizing applicant completion rate over data completeness.
- SNAP expedited eligibility screening (7-day track) requires income information at filing — without at least a gross income figure, expedited screening cannot run immediately after submission
- Full detail at intake is more burdensome for applicants — amounts, employer names, and frequencies may not be known at filing; applicants may estimate or leave blank
- Summary-only intake reduces applicant burden but adds a caseworker data-entry step and depends on documents for completeness
- The contract and the intake form are separate concerns — the schema can support full detail while allowing implementations to only require what they collect

**Options:**
- **(A)** Full detail at intake — income by source, employer, amount, frequency per person; expenses by type and amount; matches eligibility needs directly
- **(B)** Summary only at intake — gross monthly income and total expense figures; detail collected during caseworker review or via verification
- **(C)** Defer to state overlay — baseline schema omits income detail; states add fields to match their portal's collection strategy
- **(D)** Full schema, configurable required fields — the contract defines the complete income schema (all fields for source, employer, amount, frequency, type) but only marks gross income as required at submission. All other fields are optional. Implementations decide how much the intake form collects; states with simplified portals leave detail for later; states with full-featured portals collect everything upfront. The contract is the same either way.

**Decision:** Option D. The contract defines the full income schema with only gross income required at submission — the minimum needed for SNAP expedited screening. All additional detail (source, employer, frequency, type) is optional. Implementations decide how much to collect at intake; the contract does not constrain that choice.

---

### Decision 12: MAGI tax filing status fields

**Status:** Decided: A

**What's being decided:** Whether MAGI Medicaid-specific tax filing status fields (`taxFilingStatus`, `claimedAsDependentBy`, `expectToFileTaxes`, `marriedFilingJointly`) are in the baseline ApplicationMember schema or added via overlay when Medicaid support is in scope.

**Considerations:**
- MAGI-in-the-Cloud and CalSAWS include tax filing status fields directly on the member record. Cúram groups them in a separate evidence entity.
- These fields are only needed when Medicaid eligibility is in scope — a SNAP-only implementation has no use for them
- Baseline inclusion ensures any state adding Medicaid doesn't need to overlay the schema first — the fields are there and left empty for non-Medicaid cases
- Omitting from baseline keeps the schema leaner, but risks states adding in inconsistent ways (different names, types, or structure) across implementations
- The MAGI household composition logic from [Decision 9](#decision-9-member-to-member-relationship-matrix-magi) depends on `claimedAsDependentBy` and tax filing status fields — omitting them from the baseline would leave that logic without the fields it requires

**Options:**
- **(A)** Flat fields on ApplicationMember in the baseline — consistent with MAGI-in-the-Cloud and CalSAWS; multi-program-ready out of the box; adds fields irrelevant to SNAP-only states
- **(B)** Separate `TaxFilingStatus` sub-entity on ApplicationMember in the baseline — consistent with Cúram; groups MAGI-specific fields; adds a sub-object irrelevant to SNAP-only states
- **(C)** Omit from baseline — added via state overlay when Medicaid support is scoped; keeps baseline lean; risks inconsistent implementations across states

**Decision:** Option A. The MAGI household composition approach (Decision 11) already depends on `claimedAsDependentBy` and tax filing status fields in the baseline. Flat fields on `ApplicationMember` are consistent with MAGI-in-the-Cloud and CalSAWS. States without Medicaid leave them empty.

### Decision 13: Post-submission program routing — task creation and automated eligibility

**Status:** Decided: B

**What's being decided:** When `application.submitted` fires, what happens for each program in the application? Specifically: does every program generate a caseworker task immediately, or does routing depend on program type? And if multiple programs are on one application, how many tasks are created?

**Background:**

Each program has distinct federal requirements that govern whether and when a caseworker must be involved after submission:

**SNAP (7 CFR § 273.2):** Caseworker involvement is mandatory. § 273.2(e) requires the agency to conduct an interview with the household before making an eligibility determination — this cannot be bypassed by automated processing. § 273.2(i) requires the agency to determine within 1 business day of application receipt whether the household qualifies for the expedited 7-day track. The 30-day processing clock starts at application receipt. A caseworker intake task must be created immediately at submission; delay risks missing the expedited screening deadline.

**Medicaid/MAGI (45 CFR § 435.911–435.916):** Automated determination is required before caseworker involvement. The ACA (§ 435.911) requires states to attempt real-time eligibility determination using the Federal Data Services Hub (FDSH) — SSA income data, IRS tax data, and citizenship/immigration status via SAVE — before routing to a caseworker. If real-time eligibility (RTE) succeeds, the applicant is auto-approved or auto-denied with no caseworker involvement. Only when RTE is inconclusive or returns a denial does the application require human review. The 45-day processing clock (90 days for disability-based Medicaid) starts at application receipt. Creating a caseworker task before RTE runs is premature — the caseworker task may never be needed.

**TANF (45 CFR Part 261):** Federal requirements are minimal. TANF gives states broad discretion over intake procedures. There is no federal automated determination requirement and no prescribed interview structure. Most states use caseworker-driven intake; specifics are state overlay concerns.

This means routing at `application.submitted` is not uniform across programs:
- **SNAP** → caseworker intake task immediately (interview required; expedited screening deadline starts at submission)
- **Medicaid (MAGI)** → RTE system first; caseworker involvement only if inconclusive or denied (federal law requires automated determination attempt before human review)
- **TANF** → caseworker intake task (state-defined; generally caseworker-driven)

**One task per application, not per program:**

For multi-program applications (e.g., SNAP + Medicaid), the correct model is one intake task per application — not one per program. The caseworker interview covers all programs simultaneously; household composition, income, and documents are shared across programs. Creating separate per-program tasks would have the same caseworker review the same application data multiple times.

This is consistent with how integrated eligibility systems handle multi-program applications: CalSAWS, CBMS (Colorado), IBM Cúram, and Salesforce PSS all treat intake review as an application-scoped activity. Programs are attributes of the task, not the unit of task creation.

The intake task carries the full programs list from the application. Per-program status on the task (e.g., SNAP: pending review, Medicaid: pending automated check) tells the caseworker the current state of each program — which they need to act on and which are being handled by a system actor.

**Caseworker visibility into automated processing:**

For async RTE implementations, the caseworker needs to know that Medicaid is under automated processing when they open the task — otherwise they may conduct a broader interview than necessary or take action on a program that is about to be resolved automatically.

The mechanism: the workflow subscription wiring (#163) knows at task creation time — from configuration — that Medicaid goes through RTE before caseworker review. When creating the intake task from `application.submitted` where programs includes `medicaid`, the task's per-program status for Medicaid is set to "pending automated check" immediately. The caseworker sees this from the moment the task is created; no additional event from the eligibility domain is required to signal that processing has started.

When the eligibility domain resolves RTE, it emits an event (e.g., `medicaid.rte_resolved`) that the workflow domain subscribes to, updating the Medicaid per-program status on the task: either resolved (no caseworker action needed) or inconclusive/denied (caseworker action required).

States running RTE synchronously — completing it before the intake task is created — avoid this coordination entirely. The intake task is created with a definitive Medicaid status from the start.

**Open questions for #163 (cross-domain event wiring):**
- What per-program status values does the intake task expose, and where in the task schema do they live?
- What is the eligibility domain event schema for RTE resolution, and what does the workflow domain do in response to each outcome?
- How does RTE failure (FDSH unavailable) surface on the task?

**Considerations:**
- Creating a caseworker task for Medicaid at submission duplicates work — the caseworker task is unnecessary if RTE resolves the application automatically
- A subscription mechanism that creates one task per program ignores program-specific automation and would have caseworkers reviewing the same application data in separate tasks
- The blueprint cannot implement RTE (it requires access to FDSH, which is a federal data hub), but it must not preclude it — the architecture leaves room for a system actor to handle Medicaid before the caseworker scope is confirmed
- Hardcoding "one caseworker task per program at submission" would require states to work around the blueprint rather than extend it

**Options:**
- **(A)** One task per program at submission — simple, but incorrect for Medicaid and creates redundant caseworker work for multi-program applications
- **(B)** ✓ One intake task per application; program-type-aware per-program status — single task covers all programs; per-program status tells the caseworker what's pending automated processing; configurable routing in #163 sets the initial status and subscribes to eligibility resolution events
- **(C)** Two-phase routing — one shared intake task at submission; program-specific tasks fan out after intake closes — avoids duplication but delays program-specific processing and doesn't reflect how RTE actually works (Medicaid RTE runs before intake screening, not after)

**Decision:** Option B. One intake task per application is created at submission. The task carries the full programs list. Per-program status is set at task creation based on each program's known processing path — programs going through automated processing (Medicaid) are marked accordingly so the caseworker knows from the start. The subscription wiring (#163) must be program-type-aware and configurable; it cannot assume all programs go directly to caseworker review. The detailed per-program status schema and eligibility domain event contracts are open questions for #163.

---

### Decision 14: Verification checklist generation

**Status:** Decided: B

**What's being decided:** How verification obligations are generated for a submitted application — and whether they are modeled as a document-only checklist or a unified checklist covering both document and electronic verification needs.

**Considerations:**
- Verification requirements vary by program, household composition, member-level attributes, and state policy. Hardcoding requirements creates tight coupling between the domain and state policy; states cannot customize without modifying intake logic.
- All major platforms (Cúram, Pega, Salesforce) support configurable verification checklists — Pega uses dynamic "document request" case objects driven by rules; Cúram uses configurable evidence-gathering scripts; Salesforce uses Flow rules to create document checklist items. None hardcode requirements in the intake entity.
- Ex parte rules (42 CFR § 435.911) prohibit requesting paper documents for citizenship/immigration status until electronic sources (FDSH/SAVE) have been checked. Electronic checks and document requests are therefore two phases of the same obligation — they should share a unified tracking entity rather than two separate concepts.
- A document-only checklist cannot represent electronic verification obligations or their outcomes. When FDSH returns verified, there is no document to track — but the obligation is still satisfied. Electronic results need a home in the checklist.
- Two trigger points for obligation creation: (1) `application.submitted` — baseline obligations from the programs applied for; (2) `data-exchange.service-call.completed` — conditional document-based obligations when electronic checks return inconclusive.

**Rules engine design:**

`Verification` records are created by `all-match` rule sets (all matching rules fire, not just the first). Each rule set binds the application and, where member-level obligations are needed, iterates over members using a collection binding.

Household-level obligations (one per application): rule sets without collection iteration — a single `createResource` per matching rule.

Member-level obligations (one per qualifying member): rule sets with a collection binding on `application.members`, using `for/in/if` iteration to create one `Verification` per member.

Example structure (per-member income obligation):
```yaml
context:
  - as: application
    from: subject
  - as: members
    from: application.members
rules:
  - condition:
      in: [snap, {var: application.programs}]
    action:
      for: member
      in: members
      if:
        and:
          - in: [snap, {var: member.programs}]
          - "!=": [{var: member.hasIncome}, false]
      createResource:
        entity: intake/applications/verifications
        fields:
          applicationId: {var: application.id}
          memberId: {var: member.id}
          category: income
          verificationType: document
          status: pending
```

Citizenship obligations illustrate the two-phase pattern: at submission, an `electronic` `Verification` is created for FDSH; when `data-exchange.service-call.completed` fires with result `verified`, the item is set to `satisfied`; if inconclusive, a new `document` `Verification` is created for the paper citizenship proof.

**Options:**
- **(A)** Hardcoded in intake — requirements defined as static program-to-document mappings; simpler but not state-customizable
- **(B)** ✓ Rules-driven unified checklist — `all-match` rule sets generate `Verification` records covering both document and electronic obligations; states customize via overlay; intake domain has no verification requirement logic; consistent with Pega, Cúram, and Salesforce patterns; supports ex parte two-phase flow without a separate entity type

**Note on rules condition language:** JSON Logic (an open spec) is the condition layer for rule set expressions. DMN (Decision Model and Notation, OMG standard) was considered — it is supported by Camunda, Red Hat Decision Manager, and Flowable — but ruled out: DMN is XML-table-based and too heavyweight for a YAML-native format. The action vocabulary (`createResource`, `triggerTransition`, `for/in` iteration) is necessarily domain-specific regardless of condition language.

**Deferred:** `category` enum values (`residency`, `income`, `identity`, `citizenship`, `immigration`, `utilities_shelter`, etc.) are defined in the `Verification` contract implementation issue.

---

### Decision 15: Interview entity model

**Status:** Decided: B

**What's being decided:** Whether the regulatory interview requirement is modeled as a dedicated `Interview` entity in intake or as a generic appointment with `type: interview` in the scheduling domain.

**Considerations:**
- SNAP requires an interview before eligibility determination (7 CFR § 273.2(e)). The regulatory obligation is tied to the application — not to a specific appointment slot. An application that has had three canceled appointments has not yet satisfied the interview requirement.
- The interview obligation and the appointment mechanics are separable concerns: intake owns whether the interview is satisfied; scheduling owns when and where it happens.
- Pega Government Platform models the interview as a dedicated case type ("Interview") linked to the application — not a generic appointment. Cúram tracks interview completion as a milestone on the application record with separate scheduling for the meeting. Neither conflates the regulatory requirement with the scheduling event.
- A generic `appointment` entity with `type: interview` in the scheduling domain would require scheduling to know about SNAP regulatory requirements — coupling scheduling to intake policy. Scheduling should not need to know that a particular appointment type satisfies a federal regulatory obligation.
- One interview requirement may involve multiple appointments (rescheduled or no-show appointments) — one-to-many between Interview and appointments. The `Interview` entity carries an `appointments` array of appointment IDs from the scheduling domain.
- The scheduling domain does not reference back to `Interview` — the dependency is one-directional (intake → scheduling). Scheduling creates appointments without knowing whether they are tied to an interview.

**Options:**
- **(A)** Generic appointment with `type: interview` — no Interview entity in intake; scheduling domain owns the record; intake infers completion from scheduling events; couples scheduling to intake policy
- **(B)** ✓ Dedicated `Interview` entity in intake — intake owns the regulatory obligation; scheduling owns appointment mechanics; one-directional dependency (intake references scheduling appointment IDs); consistent with Pega and Cúram patterns

---

### Decision 16: Interview task creation timing

**Status:** Decided: B

**What's being decided:** When the caseworker interview task is created — at submission or when the caseworker claims the intake review task.

**Considerations:**
- SNAP interview is required before determination (7 CFR § 273.2(e)), but the regulation does not prescribe when the interview task must be created — only that the interview must occur before determination.
- Creating the interview task at submission assigns it before a caseworker is known. Queue assignment happens after submission; the caseworker who will conduct the interview is not determined until the intake review task is claimed.
- Creating the interview task when the review task is claimed means the interview task can be assigned to the claiming caseworker immediately — no unassigned floating tasks, and the interview task is linked to the caseworker's work context.
- This is consistent with how Pega and Cúram handle interview task creation: the interview obligation exists from submission, but the scheduling artifact is created when the caseworker begins active review and a worker identity is available to assign it to.

**Options:**
- **(A)** At submission — interview task created alongside the review task; unassigned until a caseworker claims the review; interview task must be re-assigned when the review task is claimed
- **(B)** ✓ At review task claim — intake subscribes to `workflow.task.claimed` for the review task; at claim time, a rule set creates the interview task assigned to the claiming caseworker; consistent with Pega and Cúram; matches the moment when a worker identity is known

---

### Decision 17: External service verification write-backs

**Status:** Decided

**What's being decided:** When an external service call (FDSH, IEVS, SAVE) returns a result, where does the outcome go — to a verification obligation record, to the member entity directly, or to the application?

**Considerations:**
- All federal external verification services operate per-person: FDSH checks citizenship and income per SSN; IEVS/The Work Number checks employment and income per SSN; SAVE checks immigration status per person. None return household-level aggregate results.
- The result carries two distinct kinds of information: (1) **whether the obligation is satisfied** (was citizenship verified? was income verified?) and (2) **verified facts** (the confirmed income amount, the confirmed citizenship status). These are different concerns — one is a checklist status, the other is a data update to the member record.
- Writing the obligation outcome directly to `ApplicationMember` as a status field blends checklist management with member data. It also doesn't generalize: once `Verification` exists as a unified checklist entity (see [Decision 14](#decision-14-verification-checklist-generation)), the obligation status naturally belongs there, not as a separate field on `ApplicationMember`.
- Writing verified facts (e.g., confirmed income amount, confirmed citizenship status) to `ApplicationMember` is correct — those are person facts that belong on the member record and are used by the eligibility domain for determination.

**Decision:** Write-backs split by concern:
- **Obligation status** → `Verification`. When `data-exchange.service-call.completed` fires, the rules engine transitions the corresponding `Verification` to `satisfied` or `inconclusive`; if inconclusive, creates a new document-based `Verification` for the paper document requirement.
- **Verified facts** → `ApplicationMember`. Facts confirmed by the external service (confirmed income amount, confirmed citizenship status, confirmed immigration category) are written to the member record via `triggerTransition` or field updates — available to eligibility for determination.

No verification obligation fields live on `Application`. No verification status fields live on `ApplicationMember` — those moved to `Verification`.

**Deferred:** The specific `ApplicationMember` fields updated per service (FDSH, IEVS, SAVE, SSA) — names, types, and allowed values — are defined in the `ApplicationMember` contract implementation issue.

---

### Decision 18: Data exchange orchestration

**Status:** Decided: Rules-engine-driven via createResource

**What's being decided:** How intake triggers external service calls (FDSH, IEVS, SAVE) — specifically, who is responsible for transforming ApplicationMember data into each external service's request format, and how those calls are initiated without coupling intake to the data exchange domain.

**Considerations:**
- Data exchange should not need to know about intake's data model. If data exchange handled the transformation, it would need to understand `ApplicationMember` schemas — coupling domains in a way that makes each harder to evolve independently.
- The same challenge exists for workflow task creation and document checklist generation: those domains (workflow, intake's document requirements) also needed intake data transformed into their own resource shapes. The rules engine solved both problems with `createResource`.
- Intake rules already have access to `ApplicationMember` fields via context bindings. The rules engine can map member fields into the data exchange request payload as part of the `createResource` action — no separate orchestration layer needed.
- This keeps data exchange as a generic platform service: it accepts `data-exchange/service-calls` resources with a `service` identifier and a `payload`, executes the call, and emits `data-exchange.service-call.completed`. It does not know what domain triggered the call or how the payload was assembled.
- States can customize which fields are mapped and which services are called via overlay — the mapping lives in rules, which are overlay-configurable.

**Decision:** Intake rules create `data-exchange/service-calls` resources via `createResource`, with member fields mapped into the service-specific request payload. Data exchange executes the call and emits a completion event. Data exchange has no knowledge of intake entities. The field mapping and service selection live entirely in the rules contract, making them state-customizable.

Example (per-member FDSH citizenship check):
```yaml
action:
  for: member
  in: members
  createResource:
    entity: data-exchange/service-calls
    fields:
      service: fdsh
      subjectType: application-member
      subjectId: {var: member.id}
      payload:
        ssn: {var: member.ssn}
        dob: {var: member.dateOfBirth}
        firstName: {var: member.firstName}
        lastName: {var: member.lastName}
```

---

### Decision 19: Unified Verification entity

**Status:** Decided: B

**What's being decided:** Whether paper document requirements and electronic service check results are tracked in a single `Verification` entity or in separate structures.

**Considerations:**
- Pega uses `VerificationRequest` for both paper and electronic; Salesforce PSS uses `VerificationRequest` with a `Type` field (`Document`, `DataCheck`, or `Both`); Cúram tracks document evidence and electronic evidence under a single evidence framework — the industry converges on unified
- 42 CFR § 435.940–960 requires states to document electronic verification attempts and their results; a unified entity provides a complete regulatory audit trail in one place
- A split model (`ApplicationDocument` for paper + `ApplicationMember.verifications[]` for electronic) forces caseworkers to consult two data structures to see the full verification state and prevents a single lifecycle from applying to both obligation types
- `ApplicationMember.verifications[]` is an array with no independent lifecycle — electronic results cannot be individually queried or transitioned through states

**Options:**
- **(A)** Separate entities — `ApplicationDocument` for paper requirements; `ApplicationMember.verifications[]` for electronic results; two structures, two query paths, no shared lifecycle
- **(B)** ✓ Unified `Verification` entity — `verificationType: document | electronic` discriminates the two; a single API endpoint (`/applications/{id}/verifications`) covers the full checklist; a shared lifecycle applies to both types

**Lifecycle:**

| State | Description |
|---|---|
| `pending` | Obligation exists, not yet resolved |
| `inconclusive` | Check or document returned an inconclusive result; transitional — caseworker must take further action |
| `satisfied` | Verification complete — document verified or electronic check confirmed |
| `waived` | Caseworker granted a waiver |
| `cannot_verify` | Unable to satisfy the obligation after exhausting available options |

Transitions: `pending → satisfied | inconclusive | waived | cannot_verify`; `inconclusive → satisfied | waived | cannot_verify`. Terminal states: `satisfied`, `waived`, `cannot_verify`.

**Customization:** The `category` enum (`citizenship`, `income`, `identity`, `residency`, `immigration`, etc.) and `source` enum (`fdsh`, `ievs`, `save`, `ssa`) are overlay-extensible. States may add program-specific verification categories or additional electronic source identifiers.

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
| Appointment scheduling mechanics | Scheduling | Intake owns the `Interview` entity (regulatory obligation); the scheduling domain owns appointments (time, location, confirmation, reminders). See [Decision 15](#decision-15-interview-entity-model). |
| WIC certification | Future — WIC domain | WIC uses a clinical certification model requiring a CPA, with no federal processing deadline and participant categories not present in SNAP/Medicaid. The WIC model departs significantly enough from the intake domain model to warrant its own design when WIC support is scoped. |
| TANF-specific intake | State overlay | Federal TANF requirements are minimal; TANF-specific intake customization is a state overlay concern |
| Benefit delivery | Case Management | Created when eligibility is determined; owned by the case management domain |

---

## References

**Federal regulations:**
- [7 CFR § 273.2 — SNAP application processing](https://www.law.cornell.edu/cfr/text/7/273.2)
- [7 CFR § 273.1 — SNAP household definition](https://www.law.cornell.edu/cfr/text/7/273.1)
- [42 CFR § 435.912 — Medicaid application processing timelines](https://www.law.cornell.edu/cfr/text/42/435.912)
- [42 CFR Part 435 Subpart I — MAGI eligibility and household composition](https://www.law.cornell.edu/cfr/text/42/part-435/subpart-I)
- [45 CFR Part 246 — WIC program](https://www.law.cornell.edu/cfr/text/45/part-246)
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
- [FNS FReD — Functional Requirements Document for a Model WIC System](https://www.fns.usda.gov/wic/fred-functional-requirements-document-model-wic-system)
