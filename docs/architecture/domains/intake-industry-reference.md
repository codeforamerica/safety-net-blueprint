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

| Event | Why it's needed | Trigger | Key payload fields | Primary consumers |
|---|---|---|---|---|
| `application.submitted` | Submission starts the regulatory clock (SNAP 30-day, Medicaid 45-day). Downstream domains cannot begin work until they know an application has been filed and when. The workflow domain needs to create a caseworker task; communication needs to send a confirmation; eligibility needs to know the household scope. | `draft` → `submitted` | `applicationId`, `submittedAt`, `programs`, `memberCount`, `isExpedited` | Workflow (create intake task), Communication (confirmation notice), Eligibility |
| `application.opened` | Signals that a caseworker has begun active review. Workflow needs to update the task state; supervisors tracking queue throughput need to know when review started vs. when it was filed. | `submitted` → `under_review` | `applicationId`, `openedAt`, `assignedToId` | Workflow (update task to in_progress) |
| `application.withdrawn` | A withdrawn application must stop all in-flight processing immediately. Open workflow tasks must be cancelled; any scheduled interview or document request must be voided; communication must notify the household. Failing to act on this event risks processing an application the household has abandoned. | any → `withdrawn` | `applicationId`, `withdrawnAt`, `reason` | Workflow (cancel open tasks), Communication (withdrawal notice) |
| `application.closed` | Signals that intake is complete and the application is ready for or has received an eligibility determination. Case Management needs this event to know when to create a service delivery case (if approved). Without it, case management has no trigger to act. | `under_review` → `closed` | `applicationId`, `closedAt` | Case Management (create case if approved), Eligibility |

**Data mutation events (open decision):**

| Event | Why it's needed | Trigger | Key payload fields | Primary consumers |
|---|---|---|---|---|
| `application.member_added` | Household composition changes after submission affect eligibility scope — a new member may qualify for different programs or change the household size used in benefit calculations. Without this event, eligibility has no way to know it needs to re-evaluate. | Member added to application | `applicationId`, `memberId`, `role` | Eligibility (re-evaluate household scope) |
| `application.expedited_flagged` | SNAP requires a determination within 7 days for expedited households. The workflow domain needs to immediately escalate to a higher-priority SLA track — the standard 30-day task SLA is wrong for these cases. | Expedited screening passes | `applicationId`, `flaggedAt` | Workflow (escalate to expedited SLA) |
| `application.income_updated` | Income changes during caseworker review may affect whether a household qualifies for expedited processing or which benefit amounts apply. Eligibility may need to re-run screening logic. | Income record changed during review | `applicationId`, `memberId` | Eligibility (re-evaluate screening) |

### Event envelope

The event envelope format is an open design decision — see Decision 11. The leading candidate is [CloudEvents 1.0](https://cloudevents.io/), a CNCF standard that is transport-agnostic and compatible with AsyncAPI should that direction be pursued later. If adopted, the standard envelope fields would be:

| Field | Description | Example |
|---|---|---|
| `specversion` | CloudEvents version | `"1.0"` |
| `id` | Unique event ID | UUID |
| `source` | Domain that emitted the event | `"/domains/intake"` |
| `type` | Event type (naming convention TBD) | `"gov.safetynets.intake.application.submitted"` |
| `time` | ISO 8601 timestamp | `"2026-04-07T14:00:00Z"` |
| `datacontenttype` | Payload format | `"application/json"` |
| `data` | Event-specific payload | see catalog above |

**Event type naming convention** is a separate open design decision — once consumers depend on it, renaming is a breaking change. See Decision 6.

---

## Key design decisions

Quick reference — each decision is detailed in the section below.

| # | Decision | Status | Rationale |
|---|---|---|---|
| 1 | Role vs. relationship on ApplicationMember | **Decided: B** | A single field can't represent a member who is both an authorized representative and a family member, or a non-applying member who has a family relationship but no application-process role. No major vendor conflates these. |
| 2 | Programs applied for — placement | **Decided: C** | Application-level alone can't distinguish voluntary non-application from ineligibility — the eligibility engine can exclude ineligible members using rules, but has no record of a member who opted out. Both levels makes intent explicit at intake and gives eligibility a clean input. |
| 3 | Program-specific eligibility attributes — structure | **Decided: A** | These are facts about the person, not the program — the same citizenship status is evaluated independently by each program's rules. No major vendor nests them per-program at intake. |
| 4 | Authorized representative — modeling | **Decided: C** | A `roles` array on ApplicationMember (rather than a single role value) allows a member to hold both `household_member` and `authorized_representative` simultaneously, supporting Medicaid's less restrictive rules while accurately representing SNAP's non-household-member requirement — the authorized rep's roles array simply omits `household_member`. No separate entity needed. |
| 5 | Domain events — scope | **Decided: publish as needed** | Both transition and data mutation events are supported. Which specific events to emit is determined per-domain based on integration needs. Schema evolution practices (additive-only payloads, type versioning, canonical schemas in OpenAPI components) govern how events are added over time. |
| 6 | Event type naming convention | **Open** | |
| 7 | Application → Case handoff | **Open** | |
| 8 | Intake phase end — lifecycle state | **Open** | |
| 9 | Application data mutability and audit trail | **Open** | |
| 10 | submitted → under_review transition trigger | **Open** | |
| 11 | Event envelope format | **Open** | |
| 12 | Member-to-member relationship matrix (MAGI) | **Open** | |
| 13 | Person identity matching | **Open** | |
| 14 | Income and expense detail at intake | **Open** | |
| 15 | MAGI tax filing status fields | **Open** | |

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
- **(B)** ✓ Separate `role` field (application process role: primary_applicant, household_member, non_applying_member, authorized_representative, absent_parent) and `relationship` field (family relationship to primary applicant: spouse, child, parent, etc.)

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

### Decision 6: Event type naming convention

**Status:** Open

**What's being decided:** The naming format for the `type` field on domain events — a load-bearing decision since consumers filter and route on event type names, and renaming is a breaking change.

**Considerations:**
- No major vendor uses a standard naming convention — all use proprietary formats (Salesforce Platform Event names, Pega signal names, Cúram event codes)
- Once consumers depend on a type name, renaming is a breaking change for all subscribers
- The `source` field on CloudEvents already carries domain context — `type` can be kept simpler if `source` is relied upon for routing
- A reverse-DNS prefix (`gov.safetynets.`) ties the names to the project and avoids collisions in shared broker environments
- This decision applies blueprint-wide, not just intake

**Options:**
- **(A)** `gov.safetynets.{domain}.{entity}.{verb}` — e.g., `gov.safetynets.intake.application.submitted`; fully qualified, collision-safe, verbose
- **(B)** `{entity}.{verb}` with `source` carrying domain context — e.g., type `application.submitted`, source `/domains/intake`; simpler type names, relies on `source` for domain routing

---

### Decision 7: Application → Case handoff

**Status:** Open

**What's being decided:** When and how an approved application creates a Case in the case management domain — what triggers it, what data carries over, and which domain is responsible for creating the Case.

**Considerations:**
- In all major vendors (Cúram, Salesforce, Pega), case creation is triggered internally within a single system — not across a domain boundary. The blueprint's explicit domain separation makes this a question vendors don't face.
- The full intake record (members, income, expenses, assets, programs approved) must be accessible to case management
- Timing question: does a case get created on approval of any one program, or after all programs in a multi-program application are determined?

**Options:**
- **(A)** Intake domain emits `application.closed`; case management subscribes and creates a Case
- **(B)** Eligibility domain emits `eligibility.determined` with outcome; case management subscribes and creates a Case only when outcome is approved
- **(C)** Case management polls closed applications and creates Cases as a batch process

---

### Decision 8: Intake phase end — lifecycle state

**Status:** Open

**What's being decided:** Whether the intake domain has an explicit lifecycle state signaling that data collection is complete and the application is ready for eligibility determination, or whether the intake domain stays open until the eligibility domain closes it.

**Considerations:**
- Cúram uses a fluid boundary — the application case stays open throughout eligibility review with no explicit "submitted for determination" state. Pega uses an explicit stage advance — the caseworker moves the case from Intake to Eligibility stage. Salesforce has no distinct intermediate state between `Under Review` and a final determination.
- A `pending_determination` state makes the domain boundary explicit — the caseworker signals when intake is complete; the eligibility domain subscribes and begins its work
- Without an explicit state, intake and eligibility overlap during `under_review`, making domain ownership harder to reason about and harder to independently scale or replace either domain
- The end of intake is determined by the caseworker's judgment, not a timer — any explicit state requires a caseworker action to trigger it, which adds a step

**Options:**
- **(A)** No explicit end state — intake `closed` when the eligibility domain closes it; fluid boundary similar to Cúram
- **(B)** Explicit `pending_determination` state — caseworker transitions the application when data collection is complete; intake emits `application.submitted_for_determination`; eligibility domain owns everything after

---

### Decision 9: Application data mutability and audit trail

**Status:** Open

**What's being decided:** How changes to application data made by caseworkers during `under_review` are tracked — and whether the intake domain owns the audit trail or delegates it.

**Considerations:**
- All major vendors track caseworker changes internally — Cúram versions each evidence update; Pega's case audit framework captures who changed what and when; Salesforce uses field history tracking. None delegate to a separate audit domain.
- Application data at determination may differ materially from the applicant's original submission — caseworkers correct entries from the interview, reconcile documents, and add information the applicant couldn't provide
- SNAP regulations require documentation of how eligibility was determined; an audit trail supports this
- Field-level tracking (who changed what, from what value) is the most granular but most complex; version-level snapshots are simpler but coarser
- A cross-cutting audit domain (subscribing to events) is architecturally clean but requires data mutation events (Decision 5B)

**Options:**
- **(A)** Field-level change tracking on Application and ApplicationMember — intake domain owns the audit trail; each update records who changed what and when, distinguishing applicant-submitted from caseworker-corrected values
- **(B)** Version-level tracking — each caseworker save creates a new snapshot of the application record; simpler than field-level but coarser granularity
- **(C)** No audit trail in intake domain — changes tracked by a separate audit/activity domain that subscribes to domain mutation events; intake stays simpler but requires Decision 5B (data mutation events)

---

### Decision 10: submitted → under_review transition trigger

**Status:** Open

**What's being decided:** Whether the `submitted → under_review` transition is triggered by an explicit intake domain action or driven by an event from the workflow domain when a caseworker claims the intake task.

**Considerations:**
- All major vendors handle this within a single system — the intake/case system and the task/workflow system are one; the cross-domain question doesn't arise. The blueprint separates them.
- The workflow-driven approach (intake reacts to a task `claim` event) is more event-driven but means another domain partially controls intake's state
- The explicit-action approach (caseworker calls the intake API to open the application) gives intake full ownership but requires an extra step
- Assignment (routing to a queue) and opening (caseworker begins review) may be two distinct moments — see the lifecycle section

**Options:**
- **(A)** Explicit intake action — caseworker calls the intake domain API to open the application; intake owns the state change; consistent with how all major vendors handle this
- **(B)** Workflow-driven — the workflow domain's task `claim` event triggers the intake domain to move to `under_review`; fewer steps, more event-driven, cross-domain coupling

---

### Decision 11: Event envelope format

**Status:** Open

**What's being decided:** The standard wrapper format for all domain events — the envelope that carries event metadata (id, source, type, timestamp) around the event-specific payload.

**Considerations:**
- No major government benefits vendor uses CloudEvents — all use proprietary formats (Salesforce Platform Events, Cúram JMS, Pega internal messaging)
- AWS EventBridge, Azure Event Grid, and Google Cloud Eventarc all natively support CloudEvents 1.0 — states on cloud infrastructure are already working with it
- CloudEvents is transport-agnostic — the same envelope works over HTTP webhooks, Kafka, SNS/SQS; state partners can adopt without introducing a message broker
- CloudEvents is explicitly compatible with AsyncAPI — adopting it now doesn't foreclose that path later
- A custom envelope has no tooling ecosystem and creates migration cost if standards adoption grows

**Options:**
- **(A)** CloudEvents 1.0 — CNCF standard, transport-agnostic, cloud-native ecosystem support, AsyncAPI-compatible, SDKs in most languages
- **(B)** Custom blueprint envelope — full control, no external dependency, no tooling ecosystem
- **(C)** No standard envelope — each domain defines its own payload shape

---

### Decision 12: Member-to-member relationship matrix (MAGI)

**Status:** Open

**What's being decided:** Whether the data model captures relationships between any two household members (required for MAGI Medicaid tax household computation) or only the relationship of each member to the primary applicant.

**Considerations:**
- Cúram and MAGI-in-the-Cloud both capture full pairwise relationships between any two members. Pega and CalSAWS capture only relationship to the head/primary applicant.
- MAGI Medicaid household composition is determined by tax filing relationships — who claims whom as a dependent, who files jointly — not physical co-habitation. Computing the tax household requires knowing how members relate to each other.
- A relationship-to-primary-only field is sufficient for SNAP (SNAP uses physical co-habitation, not tax relationships)
- A pairwise relationship matrix grows in complexity with household size — N×(N-1)/2 possible pairs for a household of N members
- If the baseline is SNAP-focused, the matrix could be added via overlay when Medicaid is scoped

**Options:**
- **(A)** Relationship to primary applicant only — single `relationship` field on ApplicationMember; sufficient for SNAP; insufficient for MAGI
- **(B)** Full pairwise relationship matrix — separate relationship entity capturing member-to-member relationships; required for MAGI; consistent with Cúram and MAGI-in-the-Cloud

---

### Decision 13: Person identity matching

**Status:** Open

**What's being decided:** Whether the intake domain resolves submitted member data (name, SSN, date of birth) to an existing person identity record, and if so, who is responsible for that matching.

**Considerations:**
- All major vendors handle matching within the same system — Cúram uses a two-stage prospect-then-match pattern; Salesforce applies duplicate rules at record creation; Pega uses built-in data matching rules. None delegate to a separate domain.
- Without matching, the same person applying multiple times creates duplicate records, leading to data quality problems and eligibility errors
- Matching at intake requires access to the person registry — a cross-domain dependency in the blueprint's domain model
- Deferring matching keeps intake simpler but risks duplicates accumulating if a household applies multiple times before a match is performed

**Options:**
- **(A)** Intake domain handles matching — ApplicationMember resolves to an existing Person or creates a new one during submission
- **(B)** Separate identity/person domain handles matching — intake submits raw member data and receives back a resolved person ID; matching logic is centralized
- **(C)** No matching at intake — identity resolution deferred to eligibility or case management phase

---

### Decision 14: Income and expense detail at intake

**Status:** Open

**What's being decided:** Whether the intake form collects full income and expense detail or a summary that is refined during caseworker review.

**Considerations:**
- Full-featured intake systems (CalSAWS, Cúram, Pega) collect full line-item income detail. Simplified portals like GetCalFresh (Code for America) collect totals only, prioritizing applicant completion rate over data completeness.
- SNAP expedited eligibility screening (7-day track) requires income information at filing — without at least a gross income figure, expedited screening cannot run immediately after submission
- Full detail at intake is more burdensome for applicants — amounts, employer names, and frequencies may not be known at filing; applicants may estimate or leave blank
- Summary-only intake reduces applicant burden but adds a caseworker data-entry step and depends on documents for completeness

**Options:**
- **(A)** Full detail at intake — income by source, employer, amount, frequency per person; expenses by type and amount; matches eligibility needs directly
- **(B)** Summary only at intake — gross monthly income and total expense figures; detail collected during caseworker review or via verification

---

### Decision 15: MAGI tax filing status fields

**Status:** Open

**What's being decided:** Whether MAGI Medicaid-specific tax filing status fields (`taxFilingStatus`, `claimedAsDependentBy`, `expectToFileTaxes`, `marriedFilingJointly`) are in the baseline ApplicationMember schema or added via overlay when Medicaid support is in scope.

**Considerations:**
- MAGI-in-the-Cloud and CalSAWS include tax filing status fields directly on the member record. Cúram groups them in a separate evidence entity.
- These fields are only needed when Medicaid eligibility is in scope — a SNAP-only implementation has no use for them
- Baseline inclusion ensures any state adding Medicaid doesn't need to overlay the schema first — the fields are there and left empty for non-Medicaid cases
- Omitting from baseline keeps the schema leaner, but risks states adding in inconsistent ways (different names, types, or structure) across implementations

**Options:**
- **(A)** Flat fields on ApplicationMember in the baseline — consistent with MAGI-in-the-Cloud; multi-program-ready out of the box; adds fields irrelevant to SNAP-only states
- **(B)** Separate `TaxFilingStatus` sub-entity on ApplicationMember in the baseline — consistent with Cúram; groups MAGI-specific fields; adds a sub-object irrelevant to SNAP-only states
- **(C)** Omit from baseline — added via state overlay when Medicaid support is scoped; keeps baseline lean; risks inconsistent implementations across states

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
