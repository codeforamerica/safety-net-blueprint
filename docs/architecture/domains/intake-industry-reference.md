# Intake Domain: Industry Reference

A data-model-focused comparison of how major government benefits platforms structure intake for SNAP, Medicaid, TANF, and WIC. For each entity this document describes: what it is, how major systems model it, and the evidence that informs open design decisions.

See [Intake Domain](intake.md) for the architecture overview and [Contract-Driven Architecture](../contract-driven-architecture.md) for the contract approach.

**Systems compared:** IBM Cúram (Merative), Salesforce Public Sector Solutions, Pega Government Platform, CalSAWS/BenefitsCal, MAGI-in-the-Cloud (HHS), 18F SNAP API prototype, CMS Marketplace API, WIC MIS systems (HANDS, Crossroads) and the FNS FReD functional reference

**Regulatory standards referenced:** 7 CFR Part 273 (SNAP), 42 CFR Part 435 (Medicaid/MAGI), 45 CFR Part 246 (WIC), 45 CFR Part 261 (TANF), ACA/MAGI household composition rules

> **Note on WIC:** WIC uses the term "certification" rather than "application." It is a clinical eligibility determination requiring a Competent Professional Authority (CPA) to assess nutritional risk. There is no federal processing deadline equivalent to SNAP's 30 days. WIC has no single dominant platform: states build or procure their own Management Information Systems (MIS). FNS publishes the **FReD** (Functional Requirements Document for a Model WIC System) as the functional reference — it is a requirements document, not a software product.

> **Note on recertification:** Recertification is triggered by an existing case nearing expiration, not by a new applicant. It belongs in the Case Management domain, not Intake. It is noted in [Out of scope](#out-of-scope) with a pointer to where it will be designed.

---

## Overview

The intake domain is responsible for capturing and structuring the data a household submits when applying for benefits. It does not determine eligibility, manage ongoing cases, or deliver benefits — those are downstream domain concerns. The intake phase begins when an application is filed (starting the regulatory clock) and ends when the application data is complete enough to submit for eligibility determination — after data collection is finished (interviews conducted, documents received, verification complete), not when the applicant first clicks submit.

**Entities owned by this domain:**

- **Application** — the root record representing one submission by a household
- **ApplicationMember** — a person linked to the application (applying or counted in household)
- Income, expenses, and assets — financial facts collected per person or household

**What this domain produces:** a structured, verified data record that downstream domains (eligibility, workflow, case management) can act on.

**How vendors structure this:**

All major platforms draw a hard boundary between the *intake phase* (a form-layer data model capturing what the applicant submitted) and the *case management phase* (a typed evidence model linked to registered participant identities). Cúram calls these the IEG Datastore and the Evidence tier. Salesforce separates `IndividualApplication`/`Assessment` objects from `BenefitAssignment`/`ProgramEnrollment`. Pega separates the Application Request case type from downstream program delivery cases. The blueprint follows the same pattern: the intake domain owns the application record; the eligibility and case management domains own what happens after.

---

## Entity model

### Application

The root entity representing one submitted application from a household.

**What it contains across vendors:**

The fields below are highlighted because they are present across all major vendors and because vendors made meaningfully different structural choices about them — differences that directly inform the blueprint's design decisions. Fields where all vendors do the same thing (e.g., a simple string name or address) are omitted since they don't require a decision. The structural differences shown here map to Decision 2 (programs applied for — where does it live?), Decision 4 (authorized representative — role on member or separate reference?), and Decision 8 (intake phase end — is status enough to signal the handoff to eligibility?).

| Field | Cúram | Salesforce | Pega | CalSAWS |
|---|---|---|---|---|
| Application ID / reference | `CASEHEADER.caseID` | `IndividualApplication.Name` | `pyID` | `applicationID` |
| Submission date | `APPLICATIONCASE.applicationDate` | `IndividualApplication.SubmittedDate` | `SubmittedDate` | `submittedDate` |
| Channel | `APPLICATIONCASE.submissionChannel` | — | `ApplicationChannel` | `applicationChannel` |
| Status | `CASEHEADER.caseStatus` | `IndividualApplication.Status` | `pyStatus` | `status` |
| Programs applied for | `BenefitTypeList` (IEG child entity) | `BenefitId` (single) or per-participant | `ProgramsApplied` (page list) | `programs` (list) |
| Primary applicant | `CASEPARTICIPANTROLE` (Primary Client role) | `AccountId` on `IndividualApplication` | `ApplicantID` | `primaryApplicantID` |
| Authorized representative flag | `authorizedRepresentativeIndicator` (IEG) | `PublicApplicationParticipant` (role) | `AuthorizedRepresentativeID` | — |

**Lifecycle states across vendors:**

Cúram: Draft → Submitted → In Review → Approved / Denied / Withdrawn
Salesforce: Draft → Submitted → Under Review → Approved / Denied / Withdrawn
Pega: Open (Intake) → Open (Eligibility) → Open (Review) → Resolved-Approved / Resolved-Denied
CalSAWS: mirrors Cúram's model, with program-specific sub-statuses

All vendors agree on the same essential arc. No vendor tracks a final determination (approved/denied) on the Application itself — that determination lives on the program delivery case or benefit assignment. The Application reaches a terminal state of `closed` (determination made downstream) or `withdrawn`.

---

### ApplicationMember

A person linked to an application. May be the primary applicant, a household member applying for benefits, a household member counted but not applying, or an authorized representative.

**What vendors call this entity:**

| System | Entity name | How linked to Application |
|---|---|---|
| Cúram (IEG phase) | `Person` (child of `Application` datastore) | Parent–child in IEG datastore |
| Cúram (backend) | `CASEPARTICIPANTROLE` + `PERSON`/`PROSPECTPERSON` | Join table on `CASEHEADER` |
| Salesforce | `PublicApplicationParticipant` | Junction: `IndividualApplication` ↔ Account/Contact |
| Pega | `HouseholdMember` entry in `Household.HouseholdMembers` | Embedded page list on `Household` entity |
| CalSAWS | `HouseholdMember` | Child of Application |
| MAGI-in-the-Cloud | `applicant` | Array on submission payload |

**How the applying vs. not-applying distinction is modeled:**

Every system must represent members who are in the household but not requesting benefits — SNAP requires all household members to be listed regardless of whether they are individually applying. All vendors solve this, but differently:

- **Pega**: `IsApplyingForBenefit` boolean on the `HouseholdMember` entry
- **Salesforce**: `ParticipantRole` picklist on `PublicApplicationParticipant` — values include `Applicant`, `Co-Applicant`, `Household Member` (not applying)
- **Cúram**: `participantRoleType` codetable on `CASEPARTICIPANTROLE` — values include `Primary Client`, `Member`, `Counted Non-Applicant`
- **MAGI-in-the-Cloud**: `is_applicant` boolean on the `applicant` object
- **CMS Marketplace API**: `has_mec` boolean (has existing coverage) and relationship field distinguish members from the primary enrollee

**How the authorized representative is modeled:**

- **Salesforce**: `PublicApplicationParticipant` with `ParticipantRole = Authorized Representative` — no separate entity
- **Cúram**: `CASEPARTICIPANTROLE` with `participantRoleType = AuthorisedRepresentative` — no separate entity
- **Pega**: `AuthorizedRepresentativeID` reference on the Application case, pointing to a separate `Person` entity

Salesforce and Cúram model the authorized representative as a *role* on the member junction record. Pega uses a separate reference from the Application entity to a Person record. See Decision 4 for the tradeoffs — the distinction matters because SNAP authorized representatives are by regulation non-household members, which makes the "role on a member" framing conceptually imprecise for that program.

**Key fields present across vendors:**

`firstName`, `lastName`, `dateOfBirth`, `gender`, `SSN`, `relationship to primary applicant`, `role / participantRoleType`, `isApplyingForBenefit` (or equivalent)

---

### Programs applied for

Which programs is this application or member requesting?

**Where vendors place this:**

- **Cúram**: `BenefitTypeList` as a child entity of `Application` in the IEG datastore — application-level. On the member side, a `Person` entity carries a `isApplyingForBenefit` flag but not a per-program breakdown.
- **Salesforce**: `BenefitId` on `IndividualApplication` for single-benefit apps; for multi-benefit, a separate `IndividualApplication` is created per benefit, or `PublicApplicationParticipant` records are created per benefit per participant.
- **Pega**: `ProgramsApplied` page list on the Application Request case — application-level. Program-specific member eligibility is evaluated by the rules engine using person-level attributes.
- **CalSAWS**: `programs` list on the Application entity — application-level. Members have `isApplyingForBenefit` boolean but not a per-member, per-program breakdown in the intake record.

**Pattern:** The application-level programs list (what programs this household is applying for) is universal. Per-member, per-program tracking (this specific member is applying for SNAP but not Medicaid) is less standardized — most vendors use a simple boolean on the member rather than a structured per-program sub-object.

---

### Program-specific eligibility attributes

Facts about a household member that are relevant to eligibility determination — citizenship status, immigration status, pregnancy, student status, disability, tax filing status.

**Where vendors place these:**

All major vendors place program-relevant attributes as **flat facts on the person/member entity**, not as nested per-program sub-objects. The eligibility rules engine applies these person facts to each program's rules independently.

- **Cúram**: `CitizenshipStatus` child entity of `Person` in IEG (fields: `citizenshipCategory`, `immigrationStatus`, `alienRegistrationNumber`, `dateOfEntry`). Pregnancy, disability as flat attributes on `Person`. Tax filing status as a separate `TaxFilingStatus` entity (required for MAGI household composition). All become typed evidence entities in the backend linked to the participant role.
- **Pega**: `CitizenshipStatus` embedded page on `Person` entity. `IsPregnant`, `DueDate`, `HasDisability`, `ReceivingSSI` as flat properties on `Person`.
- **MAGI-in-the-Cloud**: `is_pregnant`, `is_blind_or_disabled`, `is_full_time_student`, `tax_filer_status`, `is_claimed_as_dependent` as flat fields on the `applicant` object.
- **CMS Marketplace API**: `is_pregnant`, `is_parent`, `has_mec`, `uses_tobacco` as flat fields on `Person`.
- **CalSAWS**: `citizenshipStatus`, `immigrationStatus`, `isPregnant`, `hasDisability`, `receivingSSI` as flat fields on `HouseholdMember`.

**Why flat rather than per-program:**

Citizenship status does not change based on which program someone is applying for. The same fact (US citizen, LPR, etc.) is evaluated independently by SNAP rules, Medicaid rules, and TANF rules. Nesting these facts inside a per-program structure would duplicate data and complicate data entry. The eligibility domain applies person facts to program rules — that separation is the norm across all major systems.

The one attribute that is genuinely per-program is the programs list itself — which programs this member is requesting. See [Programs applied for](#programs-applied-for) above.

**Tax filing status (MAGI Medicaid):**

MAGI Medicaid uses the tax household concept — eligibility is based on tax filing status and dependency relationships, not physical household membership. This requires additional fields that are not needed for SNAP-only applications: `taxFilingStatus` (tax filer, tax dependent, non-filer), `claimedAsDependentBy` (reference to another member), `expectToFileTaxes`, `marriedFilingJointly`. Cúram models these as a separate `TaxFilingStatus` evidence entity. MAGI-in-the-Cloud puts them as flat fields on each applicant.

---

### Income, expenses, and assets

Financial facts collected to support eligibility determination.

**Standard structure across vendors:**

- **Income**: per-person, typed by source (`incomeType`: employment, self-employment, Social Security, SSI, TANF, child support, etc.), with `amount`, `frequency`, `startDate`, optionally `employer`
- **Expenses**: household-level for shelter and utilities; per-person for child care, medical (elderly/disabled), court-ordered child support paid. Cúram and Pega model these as typed child entities of `Person` or `Application`. CalSAWS mirrors this.
- **Assets/Resources**: per-person, typed (`resourceType`: bank account, vehicle, real property, life insurance), with `amount` and `description`

These are well-established sub-entities with consistent structure across vendors. The primary design questions are boundary questions (what level of detail to collect in intake vs. what belongs in ongoing case management) rather than structural ones.

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

No vendor tracks the final determination (approved/denied) on the Application itself. That determination lives on the program delivery case or benefit assignment created downstream.

### Regulatory clock

**SNAP (7 CFR § 273.2):** The 30-day processing clock starts on the *date of application receipt* — the date the household submits a minimally complete application (name, address, signature). The clock does not start when a caseworker picks up the application. For online applications submitted after hours, the filing date is the next business day. States must process within 30 days (7 days for expedited).

**Medicaid (42 CFR § 435.912):** The 45-day clock (90 days for disability-based Medicaid) starts on the application receipt date.

**WIC (45 CFR Part 246):** No federal processing deadline. Certification period varies by participant category (see Out of scope).

### What happens during intake

The intake phase spans from filing through caseworker review and data collection. The key activities and their sequence:

1. **Filing** — applicant submits a minimally complete application; regulatory clock starts; workflow task created for caseworker
2. **Expedited screening** — for SNAP, the caseworker must determine within 1 business day whether the household qualifies for expedited processing (7-day track); this happens immediately after filing
3. **Caseworker review and data correction** — the caseworker reviews what the applicant submitted for accuracy and completeness; discrepancies identified during the interview or document review are corrected in the application record; the caseworker may update, add, or correct application data on behalf of the household; this is the primary mechanism by which application data is made accurate before eligibility determination
4. **Interview** — SNAP requires an interview at initial certification; some states waive this for renewals or specific populations; information gathered in the interview may result in updates to the application data (step 3 and step 4 are often interleaved)
5. **Document collection and verification** — caseworker requests supporting documents; applicant has at least 10 days to provide them (SNAP); documents may trigger further data corrections; verification against electronic data sources (IEVS, FDSH) may run in parallel
6. **Data completion** — once the caseworker is satisfied that the application data is accurate and complete, the application is ready for eligibility determination; this is when the intake phase ends

**Implication for the data model:** Application data is mutable during `under_review`. The intake domain must support caseworker-initiated updates to application records, not just the applicant's initial submission. This has audit trail implications — changes made by caseworkers after submission should be distinguishable from the original submitted data. See Design Decision 9.

**What the intake domain does not do during this phase:** run eligibility rules, make approval/denial decisions, or create a service delivery case. Those are eligibility and case management domain concerns triggered by intake events.

### Key transitions

- **submit**: `draft` → `submitted` — applicant files; regulatory clock starts; triggers caseworker task creation and confirmation notice
- **open**: `submitted` → `under_review` — caseworker begins actively reviewing the application; caseworker review begins; assignment (routing the application to a worker's queue) may happen separately via the workflow domain and does not necessarily trigger this transition; see Decision 10
- **withdraw**: `submitted` | `under_review` → `withdrawn` — applicant-initiated; triggers open task cancellation
- **close**: `under_review` → `closed` — caseworker signals the application is ready for eligibility determination (or intake is abandoned); see Design Decision 8

---

## Domain events

### How vendors approach events

None of the major platforms are purely event-driven in the modern sense. Each has an internal event/notification mechanism but external event consumption varies significantly:

**IBM Cúram:** Uses a JMS-based internal event infrastructure. The `CuramEvent` framework publishes lifecycle events to JMS topics that internal modules can subscribe to. External integrations are primarily done via batch file exchange, SOAP web services, or the newer REST APIs introduced in v8.x — not event streaming. Cúram's evidence framework notifies internal listeners when evidence changes, which is the closest analog to data mutation events. External systems consuming Cúram events directly is uncommon; the typical pattern is Cúram polling or pushing via scheduled batch.

**Salesforce PSS:** The most event-ready of the major vendors. Salesforce Platform Events provide a pub/sub mechanism built into the platform; Change Data Capture (CDC) publishes events when records are created, updated, or deleted. External systems can subscribe via the Streaming API. For government benefits, Platform Events are used for cross-module communication within Salesforce. The event model is proprietary to the Salesforce platform — external consumers must use Salesforce's Streaming API or CometD protocol.

**Pega Government Platform:** Has an internal signals and messaging framework for case-to-case communication. Supports integration with external message brokers (Kafka, JMS) via Data Integration Services. Events are published from cases using "Message Shape" workflow steps. Like Cúram, the primary integration pattern is REST API rather than event streaming for most state implementations.

**General pattern:** These platforms were designed primarily as record-of-system platforms with REST/SOAP APIs as the primary integration surface. Event capabilities exist but are either proprietary (Salesforce Platform Events), infrastructure-dependent (Pega's Kafka integration), or oriented toward internal module communication (Cúram JMS). None natively emit events in a standard format like CloudEvents. States building modern integrations typically poll these systems' APIs or use the vendor's proprietary streaming mechanism.

**Implication for the blueprint:** The blueprint can establish a cleaner event model than any of these vendors by designing for events from the start rather than retrofitting them. The open questions are what envelope format to use, how events are delivered, and whether to adopt a standard like CloudEvents. See Decision 11.

### Transition events vs. data mutation events

An open design decision is whether the intake domain emits events only on lifecycle state transitions, or also on significant data changes that don't change the application's state.

**Transitions-only approach:** Events map 1:1 to lifecycle state changes. Simpler event model; downstream systems poll or use the state transition payload for data changes.

**Data mutations too:** Events are also emitted when significant data changes occur within a stable state — a member is added during `draft`, an income record is updated during `under_review`. More event-sourcing style; enables downstream systems to react without polling. Cúram's evidence framework emits internal notifications on every evidence change — the closest analog, though not exposed externally. Salesforce CDC publishes change events for any record update, which is the external equivalent.

See [Key design decisions](#key-design-decisions) — Decision 5.

### Event catalog

Events are listed with the operational or regulatory need that drives them — the reason a downstream domain needs to react, not just what happens to trigger them.

**Lifecycle transition events (certain):**

| Event | Why it's needed | Trigger | Primary consumers |
|---|---|---|---|
| `application.submitted` | Submission starts the regulatory clock (SNAP 30-day, Medicaid 45-day). Downstream domains cannot begin work until they know an application has been filed and when. Workflow creates one intake task per application (not per program) — the task carries the full programs list and per-program status. Programs going through automated processing (Medicaid RTE) are marked accordingly at task creation. Communication sends a confirmation; eligibility begins automated determination for applicable programs. See Decision 15 for routing details. | `draft` → `submitted` | Workflow (one intake task, per-program status — see Decision 15), Communication (confirmation notice), Eligibility (RTE for Medicaid) |
| `application.opened` | Signals that a caseworker has begun active review. Workflow needs to update the task state; supervisors tracking queue throughput need to know when review started vs. when it was filed. | `submitted` → `under_review` | Workflow (update task to in_progress) |
| `application.withdrawn` | A withdrawn application must stop all in-flight processing immediately. Open workflow tasks must be cancelled; any scheduled interview or document request must be voided; communication must notify the household. Failing to act on this event risks processing an application the household has abandoned. | any → `withdrawn` | Workflow (cancel open tasks), Communication (withdrawal notice) |
| `application.closed` | Signals that intake is complete and the application is ready for or has received an eligibility determination. Case Management needs this event to know when to create a service delivery case (if approved). Without it, case management has no trigger to act. | `under_review` → `closed` | Case Management (create case if approved), Eligibility |

**Data mutation events (open decision):**

| Event | Why it's needed | Trigger | Primary consumers |
|---|---|---|---|
| `application.member_added` | Household composition changes after submission affect eligibility scope — a new member may qualify for different programs or change the household size used in benefit calculations. Without this event, eligibility has no way to know it needs to re-evaluate. | Member added to application | Eligibility (re-evaluate household scope) |
| `application.expedited_flagged` | SNAP requires a determination within 7 days for expedited households. The workflow domain needs to immediately escalate to a higher-priority SLA track — the standard 30-day task SLA is wrong for these cases. | Expedited screening passes | Workflow (escalate to expedited SLA) |
| `application.income_updated` | Income changes during caseworker review may affect whether a household qualifies for expedited processing or which benefit amounts apply. Eligibility may need to re-run screening logic. | Income record changed during review | Eligibility (re-evaluate screening) |

### Event envelope

The adopted envelope format is [CloudEvents 1.0](https://cloudevents.io/) — see Decision 6. The envelope schema is defined in OpenAPI components for reuse and overlayability across all domains. Standard envelope fields:

| Field | Description | Example |
|---|---|---|
| `specversion` | CloudEvents version | `"1.0"` |
| `id` | Unique event ID | UUID |
| `source` | Domain that emitted the event | `"/domains/intake"` |
| `type` | Event type | `"org.codeforamerica.safety-net-blueprint.intake.application.submitted"` |
| `time` | ISO 8601 timestamp | `"2026-04-07T14:00:00Z"` |
| `datacontenttype` | Payload format | `"application/json"` |
| `data` | Event-specific payload | see catalog above |

**Event type naming convention:** `org.codeforamerica.safety-net-blueprint.{domain}.{entity}.{verb}` — see Decision 10.

---

## Key design decisions

Quick reference — each decision is detailed in the section below.

| # | Decision | Status | Rationale |
|---|---|---|---|
| 1 | [Role vs. relationship on ApplicationMember](#decision-1-role-vs-relationship-on-applicationmember) | **Decided: B** | A single field can't represent a member who is both an authorized representative and a family member, or a non-applying member who has a family relationship but no application-process role. No major vendor conflates these. |
| 2 | [Programs applied for — placement](#decision-2-programs-applied-for--placement) | **Decided: C** | Application-level alone can't distinguish voluntary non-application from ineligibility — the eligibility engine can exclude ineligible members using rules, but has no record of a member who opted out. Both levels makes intent explicit at intake and gives eligibility a clean input. |
| 3 | [Program-specific eligibility attributes — structure](#decision-3-program-specific-eligibility-attributes--structure) | **Decided: A** | These are facts about the person, not the program — the same citizenship status is evaluated independently by each program's rules. No major vendor nests them per-program at intake. |
| 4 | [Authorized representative — modeling](#decision-4-authorized-representative--modeling) | **Decided: C** | A `roles` array on ApplicationMember (rather than a single role value) allows a member to hold both `household_member` and `authorized_representative` simultaneously, supporting Medicaid's less restrictive rules while accurately representing SNAP's non-household-member requirement — the authorized rep's roles array simply omits `household_member`. No separate entity needed. |
| 5 | [Domain events — scope](#decision-5-domain-events--scope) | **Decided: publish as needed** | Both transition and data mutation events are supported. Which specific events to emit is determined per-domain based on integration needs. Schema evolution practices (additive-only payloads, type versioning, canonical schemas in OpenAPI components) govern how events are added over time. |
| 6 | [Event envelope format](#decision-6-event-envelope-format) | **Decided: A** | CloudEvents 1.0 is transport-agnostic, natively supported by AWS/Azure/GCP, and AsyncAPI-compatible. The envelope schema will be defined in OpenAPI components so it is overlayable and reusable across all domains. |
| 7 | [Intake phase end — lifecycle state](#decision-7-intake-phase-end--lifecycle-state) | **Decided: C** | Domain autonomy: each domain owns its own state transitions. A `pending_determination` state would exist to serve a downstream domain's needs, not to represent meaningful business state in intake — an event handles that better. Intake signals what it knows (`review_completed`); eligibility publishes what it knows; intake closes the application based on its own logic. |
| 8 | [Application data mutability and audit trail](#decision-8-application-data-mutability-and-audit-trail) | **Decided: C** | Audit logic should live once, not be duplicated in every domain. A cross-cutting audit domain subscribing to mutation events enables consistent version history across all domains and cross-domain queries. Mutation events must carry before/after field values or full snapshots to support version reconstruction. |
| 9 | [submitted → under_review transition trigger](#decision-9-submitted--under_review-transition-trigger) | **Decided: B** | Consistent with Decision 7: intake owns its own state transitions but reacts to events from other domains. Intake subscribes to `task.claimed` from the workflow domain and transitions the application to `under_review`. One caseworker action; intake handles the rest automatically. |
| 10 | [Event type naming convention](#decision-10-event-type-naming-convention) | **Decided: A** | Fully qualified type names are self-contained, collision-safe across organizations, and consistent with the CloudEvents community convention. Prefix is `org.codeforamerica.safety-net-blueprint.{domain}.{entity}.{verb}` — e.g., `org.codeforamerica.safety-net-blueprint.intake.application.submitted`. |
| 11 | [Member-to-member relationship matrix (MAGI)](#decision-11-member-to-member-relationship-matrix-magi) | **Decided: A** | The `claimedAsDependentBy` and tax filing status fields cover the vast majority of MAGI household composition cases. The pairwise matrix only adds precision for the edge case where a non-primary adult is a parent of a child who isn't explicitly claimed as a dependent — that case is a known gap not covered by the baseline. |
| 12 | [Person identity matching](#decision-12-person-identity-matching) | **Decided** | Identity matching is triggered at submission. The result is stored as `resolvedPersonId` on ApplicationMember. Whether the implementation is synchronous or asynchronous is left to the implementor — the contract is the same either way. |
| 13 | [Income and expense detail at intake](#decision-13-income-and-expense-detail-at-intake) | **Decided: D** | Full income schema in the contract; only gross income required at submission (SNAP expedited screening minimum). All other detail is optional. Implementations decide how much the intake form collects — the contract does not constrain that choice. |
| 14 | [MAGI tax filing status fields](#decision-14-magi-tax-filing-status-fields) | **Decided: A** | The tax filing status fields are required by the MAGI household composition logic decided in Decision 11. Omitting them from the baseline would leave that logic without the fields it depends on. Flat fields on ApplicationMember — consistent with MAGI-in-the-Cloud and CalSAWS. |

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
- **(B)** ✓ Separate `role` field (application process role: primary_applicant, household_member, non_applying_member, authorized_representative, absent_parent) and `relationship` field (family relationship to primary applicant: spouse, child, parent, etc.). Note: Decision 4 extends this to a `roles` array to support multiple simultaneous roles.

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
- **(C)** ✓ Both — Application has a programs list (household intent), ApplicationMember has a `programsApplyingFor` list (individual intent); makes voluntary non-application explicit; gives eligibility a clean input

---

### Decision 3: Program-specific eligibility attributes — structure

**Status:** Decided: A

**What's being decided:** Whether eligibility-relevant attributes (citizenship, immigration status, pregnancy, student status, disability) are flat fields on ApplicationMember or nested inside a per-program structure.

**Considerations:**
- No major vendor nests eligibility attributes per-program at intake — Cúram, Pega, MAGI-in-the-Cloud, CMS Marketplace, and CalSAWS all use flat facts on the member entity
- These are facts about the person, not the program: citizenship status doesn't change depending on which program is being applied for; the same fact is evaluated independently by each program's rules
- Per-program nesting would duplicate data (same citizenship status entered once per program) and complicate data entry
- The one genuinely per-program attribute is which programs the member is applying for — handled separately in Decision 2

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

### Decision 6: Event envelope format

**Status:** Decided: A

**What's being decided:** The standard wrapper format for all domain events — the envelope that carries event metadata (id, source, type, timestamp) around the event-specific payload.

**Considerations:**
- No major government benefits vendor uses CloudEvents — all use proprietary formats (Salesforce Platform Events, Cúram JMS, Pega internal messaging)
- AWS EventBridge, Azure Event Grid, and Google Cloud Eventarc all natively support CloudEvents 1.0 — states on cloud infrastructure are already working with it
- CloudEvents is transport-agnostic — the same envelope works over HTTP webhooks, Kafka, SNS/SQS; state partners can adopt without introducing a message broker
- CloudEvents is explicitly compatible with AsyncAPI — adopting it now doesn't foreclose that path later
- A custom envelope has no tooling ecosystem and creates migration cost if standards adoption grows

**Options:**
- **(A)** ✓ CloudEvents 1.0 — CNCF standard, transport-agnostic, cloud-native ecosystem support, AsyncAPI-compatible, SDKs in most languages; envelope schema defined in OpenAPI components for reuse and overlayability
- **(B)** Custom blueprint envelope — full control, no external dependency, no tooling ecosystem
- **(C)** No standard envelope — each domain defines its own payload shape

---

### Decision 7: Intake phase end — lifecycle state

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

### Decision 8: Application data mutability and audit trail

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

### Decision 9: submitted → under_review transition trigger

**Status:** Decided: B

**What's being decided:** Whether the `submitted → under_review` transition is triggered by an explicit intake domain action or by intake subscribing to the workflow domain's `task.claimed` event.

**Considerations:**
- All major vendors handle this within a single system — the intake/case system and the task/workflow system are one; the cross-domain question doesn't arise. The blueprint separates them.
- The event-driven approach is consistent with Decision 7: intake owns its own state transitions but reacts to events from other domains. Subscribing to `task.claimed` is not tight coupling — intake still decides to transition itself; the event is the trigger.
- The explicit-action approach requires the caseworker (or the UI) to make two calls — claim the task in workflow, then separately open the application in intake. The event-driven approach reduces this to one caseworker action.
- Assignment (routing to a queue) and opening (caseworker begins review) may be two distinct moments — the task `claim` event maps to opening, not just assignment

**Options:**
- **(A)** Explicit intake action — caseworker calls the intake domain API to open the application; intake owns the state change; requires an extra step
- **(B)** ✓ Intake subscribes to `task.claimed` — intake reacts to the workflow event and transitions the application to `under_review`; one caseworker action; consistent with the event-driven pattern established in Decision 7

---

### Decision 10: Event type naming convention

**Status:** Decided: A

**What's being decided:** The naming format for the event type identifier — a load-bearing decision since consumers filter and route on type names, and renaming is a breaking change.

**Considerations:**
- No major vendor uses a standard naming convention — all use proprietary formats (Salesforce Platform Event names, Pega signal names, Cúram event codes)
- Once consumers depend on a type name, renaming is a breaking change for all subscribers
- CloudEvents was adopted (Decision 6); the `source` field carries domain context, so a shorter type name is possible — but a fully qualified name is self-contained, easier to debug in logs, and works without requiring consumers to compose type + source for routing
- A reverse-DNS prefix avoids collisions in shared broker environments — important for a multi-state blueprint where events may cross organizational boundaries
- This decision applies blueprint-wide, not just intake

**Options:**
- **(A)** ✓ `org.codeforamerica.safety-net-blueprint.{domain}.{entity}.{verb}` — e.g., `org.codeforamerica.safety-net-blueprint.intake.application.submitted`; fully qualified, globally unique, self-contained, consistent with CloudEvents community convention
- **(B)** `{entity}.{verb}` — e.g., `application.submitted`; simpler; relies on `source` for domain context; requires consumers to compose both fields for routing

---

### Decision 11: Member-to-member relationship matrix (MAGI)

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

### Decision 12: Person identity matching

**Status:** Decided

**What's being decided:** Whether identity matching is part of intake's contract and when it is triggered.

**Considerations:**
- Without matching, the same person applying multiple times creates duplicate records leading to data quality problems and incorrect eligibility determinations — matching is necessary
- All major vendors match within the same system; Cúram creates unresolved `PROSPECTPERSON` records at submission and resolves them afterward; Salesforce and Pega match at record creation
- The contract is the same regardless of whether the implementation matches synchronously (during the submission request) or asynchronously (after); the field exists and gets populated either way — timing is an implementation choice
- Triggering at submission is the right moment: the caseworker should see prior history when they open the application for review; deferring to eligibility loses that context

**Decision:** Identity matching is triggered at submission. `ApplicationMember` carries a nullable `resolvedPersonId` field populated by the matching process. Whether the implementation calls the identity service synchronously or asynchronously is left to the implementor.

---

### Decision 13: Income and expense detail at intake

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

### Decision 14: MAGI tax filing status fields

**Status:** Decided: A

**What's being decided:** Whether MAGI Medicaid-specific tax filing status fields (`taxFilingStatus`, `claimedAsDependentBy`, `expectToFileTaxes`, `marriedFilingJointly`) are in the baseline ApplicationMember schema or added via overlay when Medicaid support is in scope.

**Considerations:**
- MAGI-in-the-Cloud and CalSAWS include tax filing status fields directly on the member record. Cúram groups them in a separate evidence entity.
- These fields are only needed when Medicaid eligibility is in scope — a SNAP-only implementation has no use for them
- Baseline inclusion ensures any state adding Medicaid doesn't need to overlay the schema first — the fields are there and left empty for non-Medicaid cases
- Omitting from baseline keeps the schema leaner, but risks states adding in inconsistent ways (different names, types, or structure) across implementations
- The MAGI household composition logic from Decision 11 depends on `claimedAsDependentBy` and tax filing status fields — omitting them from the baseline would leave that logic without the fields it requires

**Options:**
- **(A)** Flat fields on ApplicationMember in the baseline — consistent with MAGI-in-the-Cloud and CalSAWS; multi-program-ready out of the box; adds fields irrelevant to SNAP-only states
- **(B)** Separate `TaxFilingStatus` sub-entity on ApplicationMember in the baseline — consistent with Cúram; groups MAGI-specific fields; adds a sub-object irrelevant to SNAP-only states
- **(C)** Omit from baseline — added via state overlay when Medicaid support is scoped; keeps baseline lean; risks inconsistent implementations across states

**Decision:** Option A. The MAGI household composition approach (Decision 11) already depends on `claimedAsDependentBy` and tax filing status fields in the baseline. Flat fields on `ApplicationMember` are consistent with MAGI-in-the-Cloud and CalSAWS. States without Medicaid leave them empty.

### Decision 15: Post-submission program routing — task creation and automated eligibility

**Status:** Decided: B (task structure); open questions noted for #163

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

## Out of scope

The following are explicitly not intake domain concerns:

| Capability | Domain | Notes |
|---|---|---|
| Eligibility determination | Eligibility | The intake domain collects and structures data; it does not run eligibility rules or produce approved/denied outcomes |
| Recertification / renewal | Case Management | Triggered by an existing case nearing expiration, not a new applicant event |
| Notices and communications | Communication | The Communication domain subscribes to intake events (`application.submitted`, `application.withdrawn`) and sends notices; intake does not own notice generation |
| Document collection and tracking | Document Management | Intake generates tasks to collect documents; document management owns the document lifecycle |
| Pre-screening / eligibility screening | Portal / UI layer | Pre-screening does not start the regulatory clock and is a portal concern; the intake domain lifecycle starts at application submission |
| Interview scheduling | Workflow | Interviews are workflow tasks created in response to intake events; scheduling is an appointment/workflow domain concern |
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
