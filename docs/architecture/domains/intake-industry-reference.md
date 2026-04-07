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
- **assign / open**: `submitted` → `under_review` — triggered when a caseworker is assigned to or claims the application; caseworker review begins; whether this is an explicit intake domain action or driven by a workflow task claim event is an open question (see Decision 10)
- **withdraw**: `submitted` | `under_review` → `withdrawn` — applicant-initiated; triggers open task cancellation
- **close**: `under_review` → `closed` — caseworker signals the application is ready for eligibility determination (or intake is abandoned); see Design Decision 8

---

## Domain events

### Transition events vs. data mutation events

An open design decision is whether the intake domain emits events only on lifecycle state transitions, or also on significant data changes that don't change the application's state.

**Transitions-only approach:** Events map 1:1 to lifecycle state changes. Simpler event model; downstream systems poll or use the state transition payload for data changes.

**Data mutations too:** Events are also emitted when significant data changes occur within a stable state — a member is added during `draft`, an income record is updated during `under_review`. More event-sourcing style; enables downstream systems to react without polling. This is analogous to how Cúram's evidence framework emits a notification on every evidence change, and how Salesforce creates `BenefitAssignmentAdjustment` records for post-approval changes.

See [Key design decisions](#key-design-decisions) — Decision 5.

### Event catalog

**Lifecycle transition events (certain):**

| Event | Trigger | Key payload fields | Primary consumers |
|---|---|---|---|
| `application.submitted` | `draft` → `submitted` | `applicationId`, `submittedAt`, `programs`, `memberCount`, `isExpedited` | Workflow (create intake task), Communication (confirmation notice), Eligibility |
| `application.withdrawn` | any → `withdrawn` | `applicationId`, `withdrawnAt`, `reason` | Workflow (cancel open tasks), Communication (withdrawal notice) |
| `application.closed` | `under_review` → `closed` | `applicationId`, `closedAt` | Case Management (create case if approved) |

**Data mutation events (open decision):**

| Event | Trigger | Key payload fields | Primary consumers |
|---|---|---|---|
| `application.member_added` | Member added to application | `applicationId`, `memberId`, `role` | Eligibility (re-evaluate household scope) |
| `application.expedited_flagged` | Expedited screening passes | `applicationId`, `flaggedAt` | Workflow (escalate to expedited SLA) |
| `application.income_updated` | Income record changed during review | `applicationId`, `memberId` | Eligibility (re-evaluate) |

### Event envelope

The blueprint uses the [CloudEvents 1.0](https://cloudevents.io/) envelope standard for all domain events. CloudEvents is a CNCF standard that is transport-agnostic — the same envelope works over HTTP webhooks, Kafka, SNS/SQS, or any other transport. State partners can adopt the envelope without introducing a message broker.

Standard fields on every event:

| Field | Description | Example |
|---|---|---|
| `specversion` | CloudEvents version | `"1.0"` |
| `id` | Unique event ID | UUID |
| `source` | Domain that emitted the event | `"/domains/intake"` |
| `type` | Event type (naming convention TBD) | `"gov.safetynets.intake.application.submitted"` |
| `time` | ISO 8601 timestamp | `"2026-04-07T14:00:00Z"` |
| `datacontenttype` | Payload format | `"application/json"` |
| `data` | Event-specific payload | see catalog above |

**Event type naming convention** is an open design decision — once consumers depend on it, renaming is a breaking change. See [Key design decisions](#key-design-decisions) — Decision 6.

---

## Key design decisions

| # | Decision | Options | Status |
|---|---|---|---|
| 1 | Role vs. relationship on ApplicationMember | (A) Single `relationship` field encoding both application role and family relationship; (B) Separate `role` field (application process role) and `relationship` field (family relationship to primary applicant) | **Open** |
| 2 | Programs applied for — placement | (A) Application level only — one programs list on the Application; (B) Member level only — each ApplicationMember has a `programsApplyingFor` list; (C) Both — application has a programs list (household intent), member has a `programsApplyingFor` list (individual intent) | **Open** |
| 3 | Program-specific eligibility attributes — structure | (A) Flat on ApplicationMember — citizenship, immigration status, pregnancy, etc. as direct fields; (B) Per-program nested — each program entry on the member has its own sub-object; (C) Hybrid — flat for shared person facts, per-program only for genuinely program-specific attributes | **Open** |
| 4 | Authorized representative — modeling | (A) Role on ApplicationMember (`role: authorized_representative`) — consistent with Salesforce and Cúram; (B) Separate entity on Application — consistent with Pega | **Open** |
| 5 | Domain events — scope | (A) Transition events only — events map 1:1 to lifecycle state changes; (B) Data mutation events too — events also emitted on significant data changes within a stable state | **Open** |
| 6 | Event type naming convention | (A) `gov.safetynets.{domain}.{entity}.{verb}` (e.g., `gov.safetynets.intake.application.submitted`); (B) `{domain}.{entity}.{verb}` with `source` field providing the domain context | **Open** |
| 7 | Application → Case handoff | When and how does an approved application create a Case in the case management domain? What event triggers it? What data is carried over? This is a cross-domain boundary decision affecting both intake and case management. | **Open** |
| 8 | Intake phase end — lifecycle state | (A) No explicit end state — intake closes when the eligibility domain closes it (fluid boundary, similar to Cúram); (B) Explicit `pending_determination` state — intake emits an event and transitions to a terminal state when data collection is complete, signaling the eligibility domain to begin; the eligibility domain owns everything after | **Open** |
| 10 | submitted → under_review transition trigger | (A) Explicit intake action — caseworker directly transitions the application to `under_review` via an intake domain API call; intake owns the state change; (B) Workflow-driven — the workflow domain's task `claim` event triggers the application state change; the intake domain subscribes to that event; cross-domain dependency but avoids requiring a separate explicit caseworker action | **Open** |
| 9 | Application data mutability and audit trail | Application data is mutable during `under_review` as caseworkers correct and complete what the applicant submitted. (A) Track changes at the field level — each update records who changed what and when, distinguishing applicant-submitted vs. caseworker-corrected values; (B) Track changes at the submission level — each caseworker save creates a new version of the application record; (C) No explicit audit trail in the intake domain — changes are tracked in a separate audit/activity log owned by another domain | **Open** |

### Decision context

**Decision 1 — Role vs. relationship:**
Cúram separates these clearly: the application-process role lives on `CASEPARTICIPANTROLE.participantRoleType`; the family relationship lives in a separate relationship evidence entity. Salesforce's `PublicApplicationParticipant.ParticipantRole` covers application-process roles (Applicant, Household Member, Authorized Representative); family relationships are modeled separately via `PartyRelationshipGroupMember.MemberRole`. Pega similarly separates `IsHeadOfHousehold` and `RelationshipToHouseholdHead` from the member's role in the application.

The risk in conflating them: an authorized representative may also be a family member; a non-applying member has no meaningful application-process role but still has a family relationship that matters for MAGI Medicaid tax-household composition.

**Decision 2 — Programs applied for:**
Cúram and Pega track programs at the application level. Salesforce creates separate application records per benefit for multi-benefit applications (application level) or uses participant records (member level). CalSAWS tracks at application level with a simple `isApplyingForBenefit` boolean per member. No major vendor tracks per-member, per-program in a structured sub-object at the intake stage. Most use a boolean flag on the member combined with an application-level programs list.

However, "less standardized" does not mean "less necessary." Per-member, per-program tracking is required by regulation for multi-program applications: Medicaid eligibility is determined individually for each household member (each person gets their own determination); SNAP allows individual members to be excluded from the household (non-citizens, ineligible students) even while living there; WIC is fully individual certification. The reason vendors don't expose this as a clean structured feature is largely that they push the distinction downstream — Salesforce handles it by creating separate application records per program; Cúram and Pega evaluate per-member, per-program household composition in the eligibility rules engine using the same underlying person data. This is a design choice — pushing the distinction into the eligibility layer rather than making it explicit at intake. The tradeoff: keeping it implicit in intake is simpler and more flexible, but eligibility receives less explicit input and must infer more. Making it explicit at intake gives eligibility a cleaner handoff but requires the intake data model to carry more structure.

**Decision 3 — Eligibility attributes structure:**
Every major vendor surveyed — Cúram, Pega, Salesforce, CalSAWS, MAGI-in-the-Cloud, CMS Marketplace API — places citizenship, immigration status, pregnancy, disability, and student status as flat attributes on the person/member entity. None use per-program nested objects for these facts at the intake stage. The eligibility rules engine applies person facts to program rules independently.

**Decision 4 — Authorized representative:**
Salesforce and Cúram both model the authorized rep as a role on the participant junction record. Pega uses a separate reference from the application to a person entity. SNAP regulations (7 CFR § 273.2(n)) require the designation to be in writing and distinguish the authorized rep from household members — both approaches can satisfy this.

A key regulatory distinction affects this decision: for SNAP, the authorized representative must be an "adult nonmember of the household" — they are explicitly outside the household and never apply for benefits on the same application. For Medicaid (42 CFR § 435.923), the restriction is less clear and a household member could act as authorized representative. This matters for modeling: if the authorized rep is typically an external party (CBO worker, social worker, attorney) with no other connection to the application, modeling them as a role on `ApplicationMember` is conceptually odd — they are not a household member. A separate reference from the Application entity (Pega's approach) more accurately reflects this. The role-on-member approach is more natural when the authorized rep is always a person already represented elsewhere in the application.

**Decision 8 — Intake phase end:**
Cúram's model is fluid: the `ApplicationCase` stays open throughout eligibility review; eligibility rules can be run at any point against current evidence; the case closes when a final determination is made. There is no explicit "submitted for determination" state. Pega is more explicit: the Application Request case type has distinct stages (Intake → Eligibility → Review → Determination), and the stage transition from Intake to Eligibility is the clean handoff point.

The tradeoff: a `pending_determination` state makes the domain boundary explicit and gives the intake domain a clean terminal event (`application.submitted_for_determination`) that the eligibility domain subscribes to. Without it, the intake and eligibility domains overlap during `under_review`, which makes it harder to reason about ownership and harder to independently scale or replace either domain. The cost is an additional state and transition to manage.

Note: the end of the intake phase is determined by the caseworker completing their review (Decision 9), not by a timer. The caseworker signals readiness when they are satisfied the application data is accurate and complete.

**Decision 9 — Application data mutability and audit trail:**
Caseworkers routinely update application data during `under_review` — correcting entries based on the interview, reconciling discrepancies between submitted information and received documents, and adding information the applicant could not provide at submission. This means the application record at the point of eligibility determination may differ materially from what the applicant originally submitted. Cúram handles this through its evidence management system — all evidence is "In Edit" during the application phase, and changes are versioned. Pega tracks changes through its case audit framework. Salesforce creates a `BenefitAssignmentAdjustment` for post-approval changes but relies on standard Salesforce field history for in-review changes.

The blueprint needs to decide whether the audit trail is the intake domain's responsibility (field-level change tracking on the Application and ApplicationMember entities) or a cross-cutting concern handled by a separate audit/activity domain that subscribes to mutation events.

**Decision 10 — submitted → under_review trigger:**
Most vendors handle this as an explicit caseworker action: in Cúram, the worker is assigned to the `ApplicationCase` and the case status updates; in Pega, the caseworker opens the Application Request case and begins the Intake stage. Neither system uses a cross-domain event from a workflow/task system to drive the application state change — the intake/case system owns both the task assignment and the case status. For the blueprint, where the workflow domain is separate from the intake domain, this creates a choice: requiring a separate explicit API call on the intake domain to open the application (clean domain ownership, extra step) vs. having the intake domain react to workflow events (fewer steps, cross-domain coupling). The workflow-driven approach is more event-driven but means the intake domain's state is partially controlled by another domain.

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
