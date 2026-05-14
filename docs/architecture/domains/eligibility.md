# Eligibility Domain

The Eligibility domain covers the process of determining whether a household and its members qualify for benefits — from the moment an application is submitted through the final per-person, per-program Decision. Regulatory context references 7 CFR § 273.2 (SNAP), 42 CFR Part 435 (Medicaid/MAGI), and 45 CFR Part 261 (TANF).

## Overview

The Eligibility domain determines whether each member of a household qualifies for each program they applied for. It evaluates applications at submission and again when caseworker review is complete, applies program-specific eligibility rules, and publishes outcomes — expedited flags and Decisions — as events for downstream domains to act on. The domain does not collect application data, manage cases, or issue benefits; those are owned by Intake and Case Management.

The primary object the domain manages is the **Determination** — a per-application record that tracks the outcome of evaluating each eligible household member for each program applied for. A Determination contains one **Decision** per person-program combination; together, the Decisions represent the complete eligibility picture for the household.

## What happens during eligibility determination

Eligibility evaluates in response to two triggers: application submission and caseworker review completion. At submission it runs expedited screening and, for Medicaid applications, electronic eligibility checks against federal data sources. For any Decisions that can be reached from that data alone, it records them immediately. The remaining Decisions are evaluated when caseworker review is signaled as complete. When all Decisions are resolved, the Determination is complete.

1. When an application is submitted, Eligibility evaluates whether the household meets the criteria for expedited SNAP processing — specifically, whether the household's combined income and resources are low enough to require a 7-day determination rather than the standard 30-day timeline. (7 CFR § 273.2(i)) This is a household-level result recorded on the Determination, not on any individual Decision. This evaluation uses only the information the household provided at submission; no additional verification or electronic data checks are required.

2. For applications that include Medicaid, Eligibility queries federal data sources — IRS records for MAGI income and federal hub data for existing Medicare or Medicaid coverage. (42 CFR § 435.911) When those checks return enough data to assess eligibility, the federal ex parte rule requires Eligibility to record a formal Medicaid Decision for that member immediately, without caseworker involvement: `approved` if the member meets program criteria, `denied` if not. When checks return insufficient data — unavailable, timed out, or conflicting — the Decision remains `pending` for caseworker review. The results of each electronic check are recorded on the Decision regardless of outcome, both for the audit trail required by federal regulation and to inform caseworker review. (42 CFR § 435.916) This step applies only to Medicaid; SNAP requires a caseworker interview before any Decision is recorded. (7 CFR § 273.2(e))

3. For any Decisions that cannot be reached at submission, Eligibility waits for a signal that the application is ready for determination. That signal is Intake's authoritative declaration that caseworker review is complete and all verifications are resolved — Eligibility trusts it without independently checking verification status. Upon receiving it, Eligibility applies program eligibility rules for each remaining Decision using the application data. See [Decision 8](#decision-8-eligibility-trust-boundary-with-intake).

4. When all Decisions in the Determination are resolved, Eligibility signals that the application is fully determined.

## Regulatory requirements

### Processing clocks

Eligibility determinations must be completed within the regulatory deadlines that start at application filing — not when a caseworker picks up the application or when all documents are received.

| Program | Deadline | Citation | Notes |
|---|---|---|---|
| SNAP standard | 30 calendar days | 7 CFR § 273.2(g)(1) | From application receipt date |
| SNAP expedited | 7 calendar days | 7 CFR § 273.2(i) | For households meeting expedited criteria |
| Medicaid standard | 45 calendar days | 42 CFR § 435.912 | From application receipt date |
| Medicaid disability | 90 calendar days | 42 CFR § 435.912(b) | When a disability determination is required |
| TANF | State-defined | 45 CFR Part 261 | No federal deadline |

### Medicaid ex parte rule

Federal law requires states to make a determination using available electronic data before requesting any additional information from the applicant. When a Medicaid applicant's data is sufficient — income from IRS records, citizenship and immigration status from federal hub data, existing coverage confirmed or ruled out — the state must make a determination automatically without caseworker involvement. Requesting documents or routing to a caseworker is permitted only when electronic checks are inconclusive or unavailable. (42 CFR § 435.911, 42 CFR § 435.916)

This rule applies only to Medicaid. It governs the determination step; a related but distinct rule (42 CFR § 435.940) governs the electronic verification step in Intake.

### SNAP expedited screening

Federal rules require the agency to determine within 1 business day whether a household qualifies for expedited (7-day) processing. (7 CFR § 273.2(i)) This evaluation uses only submitted income and resource data — no verification or caseworker review is required. The only submission-time evaluation for SNAP is this binary expedited flag; there is no equivalent electronic determination step for SNAP at submission.

Expedited criteria: households with gross monthly income below $150 and liquid resources at or below $100; migrant or seasonal farm workers with resources at or below $100; households whose combined income and resources fall below the monthly rent or mortgage and utility costs.

## Entity model

### Determination

The root entity tracking the eligibility outcome for one application. Created when the application is submitted and stays open until all person-program combinations are resolved. Status is derived from the aggregate state of its Decisions.

All major platforms have an equivalent application-level determination record that accumulates individual program decisions.

Key fields:
- `applicationId` — links the Determination to its application
- `status` — overall resolution state: `pending` | `in_progress` | `completed`
- `expeditedFlagged` — whether the household qualifies for expedited SNAP processing, as determined by SNAP expedited screening at submission. This is a household-level result — it evaluates the household's combined income and resources, not individual members — which is why it sits on the Determination rather than on any individual Decision. When true, Intake stores a copy on the Application for caseworker-facing display. See [Decision 3](#decision-3-ownership-of-expedited-screening).

See [Decision 2](#decision-2-determination-entity-model).

### Decision

A per-person, per-program outcome within a Determination. One Decision is created for each combination of household member and program applied for when the Determination begins; each is updated independently as the eligibility rules engine evaluates it.

A two-level model (Determination → Decision) is used because eligibility criteria, processing paths, timelines, and denial reasons differ by person and by program.

Key fields:
- `determinationId`, `memberId`, `program` — links the Decision to its Determination, the specific household member, and the program (e.g., `snap`, `medicaid`, `tanf`)
- `status` — current evaluation state: `pending` (not yet evaluated or electronic checks were inconclusive) | `approved` (member meets program criteria) | `denied` (evaluated; did not meet eligibility criteria — has appeal rights) | `ineligible` (categorically excluded before eligibility criteria apply, e.g., citizenship status for SNAP, age for TANF). `approved`, `denied`, and `ineligible` are terminal — no further evaluation occurs once a Decision reaches one of these states. `pending` is the only non-terminal state.
- `path` — which evaluation path reached this decision: `auto` (ex parte, no caseworker) or `manual` (caseworker review completed). Required for federal audit and CMS reporting; ex parte determinations must be distinguishable from caseworker-reviewed ones.
- `decidedAt` — when the decision was finalized; used to verify regulatory deadline compliance
- `denialReasonCode` — coded value required when status is `denied`; used to generate the Notice of Action and establish the basis for any appeal. Codes are program-specific and defined at implementation from federal reporting code sets (FNS for SNAP, CMS for Medicaid).
- `electronicChecks` — records of the electronic data calls made at submission for this Decision (service queried, result received, timestamp); present only for Medicaid Decisions where ex parte evaluation was attempted. Provides the audit trail required by 42 CFR § 435.916 and supports caseworker review of why a Decision was auto-resolved or left pending.

See [Decision 2](#decision-2-determination-entity-model), [Decision 4](#decision-4-submission-time-electronic-evaluation-scope).

## Determination lifecycle

### States

| State | Description | SLA clock |
|---|---|---|
| `pending` | Determination created; evaluation not yet started | running |
| `in_progress` | Eligibility evaluation underway — electronic checks initiated at submission or rules engine running after caseworker review | running |
| `completed` | All person-program Decisions resolved | stopped |
| `withdrawn` | Application withdrawn before all Decisions resolved; pending Decisions are moot | stopped |

### Key transitions

- **Application submitted → `pending`** — Determination is created when Intake signals submission; expedited screening and, for Medicaid applications, electronic eligibility checks begin immediately. See [Decision 1](#decision-1-eligibility-trigger-at-submission).
- **Evaluation begins → `in_progress`** — transitions when Eligibility starts evaluating: at submission when electronic checks are initiated (for Medicaid applications), or when the rules engine runs after caseworker review completes (for all remaining Decisions)
- **Caseworker review completed → rules engine runs** — when Intake signals that review is complete, the rules engine evaluates all remaining undetermined combinations using the verified application data
- **All Decisions resolved → `completed`** — when the last pending Decision reaches a terminal state, the Determination moves to `completed` and the all-determined signal fires. See [Decision 5](#decision-5-all-determined-tracking).
- **Application withdrawn → `withdrawn`** — when Intake signals that the application has been withdrawn, the Determination moves to `withdrawn` regardless of how many Decisions are still pending; any already-resolved Decisions remain as the audit record.

## SLA and deadline management

Regulatory processing deadlines apply to the application as a whole — they run from the date of filing and govern how quickly the agency must complete the full process, not just the eligibility evaluation step. SLA definition, tracking, breach alerts, and escalation are owned by the Workflow domain. Eligibility's role is to communicate which track applies: it fires the expedited flag event at submission, and Workflow subscribes to switch the intake task to the appropriate SLA track.

| Regulatory deadline | Starts when | Deadline | Citation |
|---|---|---|---|
| Standard SNAP | Application filed | 30 calendar days | 7 CFR § 273.2(g)(1) |
| Expedited SNAP | Application filed | 7 calendar days | 7 CFR § 273.2(i) |
| Standard Medicaid | Application filed | 45 calendar days | 42 CFR § 435.912 |
| Disability Medicaid | Application filed | 90 calendar days | 42 CFR § 435.912(b) |

## Domain events

### Event types

The Eligibility domain emits three event types. One fires at submission when the expedited screening result is available. One fires each time a Decision reaches a terminal state — including Medicaid Decisions resolved automatically at submission. One fires when all Decisions in a Determination are resolved. All events follow the platform CloudEvents format.

### Event catalog

| Event | Why it's needed | Trigger | Primary consumers |
|---|---|---|---|
| `eligibility.application.expedited` | SNAP requires the agency to notify caseworkers within 1 business day so the application can be prioritized (7 CFR § 273.2(i)); Workflow needs the flag to switch the intake task to the expedited SLA track | Expedited screening completes at submission and application meets criteria | Intake (set `isExpedited` on application), Workflow (apply expedited SLA track) |
| `eligibility.application.decision_completed` | Intake must record each decision outcome per-person per-program as it resolves; this event may fire multiple times — including at submission for Medicaid Decisions auto-resolved via ex parte evaluation | A Decision transitions to a terminal state (`approved`, `denied`, `ineligible`) | Intake |
| `eligibility.application.determination_completed` | Intake requires a single signal that the application is fully determined before closing it and triggering case creation. See [Decision 5](#decision-5-all-determined-tracking). | All Decisions in a Determination reach a terminal state | Intake |

Eligibility also subscribes to `application.withdrawn` from Intake. When an application is withdrawn, Eligibility moves the Determination to `withdrawn`; any already-resolved Decisions remain as the audit record.

## Contract artifacts

| Artifact | File |
|---|---|
| OpenAPI spec | `eligibility-openapi.yaml` |
| State machine | `eligibility-state-machine.yaml` |

## Key design decisions

| # | Decision | Summary |
|---|---|---|
| 1 | [Eligibility trigger at submission](#decision-1-eligibility-trigger-at-submission) | Eligibility subscribes to the application submitted event rather than being called directly by Intake |
| 2 | [Determination entity model](#decision-2-determination-entity-model) | Two-level: Determination per application contains Decisions per person per program |
| 3 | [Ownership of expedited screening](#decision-3-ownership-of-expedited-screening) | Eligibility owns the expedited screening evaluation; Intake and Workflow react to the result via event |
| 4 | [Submission-time electronic evaluation scope](#decision-4-submission-time-electronic-evaluation-scope) | Electronic eligibility evaluation at submission applies to Medicaid only; SNAP has the binary expedited flag; other programs get neither |
| 5 | [All-determined tracking](#decision-5-all-determined-tracking) | Eligibility tracks Decision terminal states internally and fires one all-determined event when the last resolves |
| 6 | [Conditions for automatic Decision resolution](#decision-6-conditions-for-automatic-decision-resolution) | Automatic Decision resolution applies to Medicaid only when all electronic checks at submission return conclusive results |
| 7 | [Determination REST query surface](#decision-7-determination-rest-query-surface) | Determination and Decision are exposed as queryable REST resources; Eligibility is the authoritative record |
| 8 | [Eligibility trust boundary with Intake](#decision-8-eligibility-trust-boundary-with-intake) | Eligibility trusts Intake's ready-for-determination signal and does not independently verify application completeness |
| 9 | [Data exchange service call ownership](#decision-9-data-exchange-service-call-ownership) | Intake calls verification-oriented services; Eligibility calls determination-oriented services |
| 10 | [Notice of Action trigger](#decision-10-notice-of-action-trigger) | NOA triggered at `intake.application.closed` — fires after all post-determination steps including supervisor approval |
| 11 | [Eligibility rules engine scope](#decision-11-eligibility-rules-engine-scope) | Program eligibility rules are adapter-layer; the blueprint defines data model, API, and events, not eligibility criteria |

---

### Decision 1: Eligibility trigger at submission

**Status:** Decided: B

**What's being decided:** Whether Intake calls Eligibility directly via API at submission, or whether Eligibility subscribes to the application submitted event. The choice determines whether Intake has a runtime dependency on Eligibility — whether it must know Eligibility's endpoint, handle Eligibility being unavailable, and retry on failure.

**Options:**
- **(A)** Intake calls Eligibility directly at submission; Eligibility responds synchronously; the submission is not confirmed until Eligibility acknowledges it
- **(B)** ✓ Eligibility subscribes to the application submitted event; Intake fires and does not wait; Eligibility handles its evaluation asynchronously

**Decision:** Option B keeps the domains decoupled. Under Option A, Intake must know Eligibility's endpoint, handle Eligibility being unavailable, and manage retries — adding operational complexity and a cross-domain runtime dependency for a call that Eligibility can initiate itself. Bounded context design favors letting each domain react to events rather than having calling domains orchestrate downstream work; a submission event is a natural integration point that lets Eligibility evolve, scale, and fail independently of Intake.

---

### Decision 2: Determination entity model

**Status:** Decided: B

**What's being decided:** How to structure the eligibility outcome record — whether a single record per application is sufficient, or whether a two-level structure is needed (application-level record containing per-person per-program decisions).

**Considerations:**
- Programs have different eligibility criteria: a household member may qualify for Medicaid but not SNAP; SNAP evaluates the household as a unit while Medicaid evaluates each person individually for MAGI
- Federal regulations require a Notice of Action with distinct outcomes per program per member (7 CFR § 273.2(h), 42 CFR § 435.917) — a flat application-level record cannot produce this without embedding the per-member structure anyway

**Options:**
- **(A)** One determination record per application with a flat approved/denied status
- **(B)** ✓ Determination (per application) containing Decision records (per person per program); Determination status derived from the aggregate state of its Decisions

---

### Decision 3: Ownership of expedited screening

**Status:** Decided: B

**What's being decided:** Which domain is responsible for evaluating SNAP expedited screening criteria — whether that evaluation belongs in Intake (data collection) or in Eligibility (program rules and determination).

**Considerations:**
- Expedited screening is an eligibility determination: it applies program-defined income and resource thresholds to determine which regulatory processing track applies (7 CFR § 273.2(i)); it is not a data collection or intake function
- Placing program-rule evaluation in Intake couples the data collection domain to eligibility criteria that can change independently; any future expedited-equivalent criteria for other programs would follow the same pattern, progressively embedding eligibility logic in the wrong domain

**Options:**
- **(A)** Intake evaluates expedited criteria at submission and sets the flag on the Application; Eligibility reads it when building its Determination
- **(B)** ✓ Eligibility owns expedited screening: evaluates the criteria, records the result on the Determination, and communicates it to Intake and Workflow via event; each domain acts on the result within its own boundary

**Decision:** Eligibility evaluates and is authoritative. Intake stores a copy of the result on the Application as a deliberate denormalization — the Application is the primary object caseworkers work with, and they should not need a cross-domain query to Eligibility to see whether a case is expedited.

---

### Decision 4: Submission-time electronic evaluation scope

**Status:** Decided: B

**What's being decided:** Which programs receive electronic eligibility evaluation at submission — querying federal data sources to attempt an immediate Decision before caseworker review — and which do not.

**Considerations:**
- The Medicaid ex parte rule (42 CFR § 435.911) requires electronic checks before a caseworker is involved; this rule is what makes submission-time evaluation mandatory for Medicaid
- For SNAP and TANF, applicants typically do not provide enough information at submission to make a reliable electronic determination — income and household data are self-reported and unverified at that point; the only submission-time evaluation the baseline supports for SNAP is the binary expedited flag, which uses only gross income and liquid resources against simple thresholds

**Options:**
- **(A)** Electronic evaluation at submission for all programs — attempt an immediate Decision for SNAP, Medicaid, TANF, and others using whatever data is available
- **(B)** ✓ Electronic evaluation at submission only for Medicaid; SNAP gets only the binary expedited flag; TANF and other programs get neither at baseline

**Customization:** See [Submission-time electronic evaluation for non-Medicaid programs](#submission-time-electronic-evaluation-for-non-medicaid-programs).

---

### Decision 5: All-determined tracking

**Status:** Decided: A

**What's being decided:** How Eligibility knows when all person-program combinations for an application are resolved so it can fire the all-determined signal.

**Options:**
- **(A)** ✓ Eligibility tracks Decision terminal states internally on the Determination; when the last pending Decision resolves, Eligibility fires `eligibility.application.determination_completed`
- **(B)** Intake tracks which determination events it has received and fires a signal when the count matches the expected set

**Decision:** Option A is the right owner: the entity that owns the Decisions can directly observe when the last one resolves. Option B requires Intake to know in advance how many person-program combinations exist, which is not always deterministic — some members may be found categorically ineligible before evaluation completes, reducing the expected count.

---

### Decision 6: Conditions for automatic Decision resolution

**Status:** Decided: A

**What's being decided:** Under what conditions a Decision can be recorded automatically — without caseworker review — at application submission.

**Considerations:**
- 45 CFR § 435.911 requires Medicaid to be auto-determined when electronic data is sufficient — income from IRS (FDSH FTI), citizenship from SSA records (FDSH SSA), existing coverage from Medicare and VCI checks
- SNAP cannot be auto-determined: federal law requires a caseworker interview before a SNAP determination (7 CFR § 273.2(e))
- If an application includes both Medicaid and SNAP, Medicaid decisions may auto-complete while SNAP awaits caseworker review; the Determination enters `in_progress` while the SNAP Decisions remain `pending`

**Options:**
- **(A)** ✓ Auto-determination applies only when: (1) the application includes Medicaid, AND (2) all Medicaid electronic checks at submission return conclusive results; only Medicaid Decisions auto-determine — SNAP and other programs always follow the manual path
- **(B)** Auto-determination applies to any program whose eligibility criteria can be evaluated from data available at submission (state-configurable)

**Decision:** Option A follows the regulatory mandate directly. Option B would require explicit carve-outs for SNAP (which has a mandatory interview requirement) and would create risk for TANF programs that have state-defined interview or verification requirements. The configuration complexity does not justify the limited benefit.

---

### Decision 7: Determination REST query surface

**Status:** Decided: A

**What's being decided:** Whether Determination and Decision are exposed as queryable REST resources by the Eligibility domain, or kept internal with outcomes available only through events.

**Considerations:**
- Without a queryable API, every consumer that needs the current determination state must either replay events or store its own copy; this is exactly what created the open gap in Intake (#248 — no per-person per-program entity) — that gap exists because Eligibility's REST surface hasn't been designed
- Events propagate outcomes to subscribers at determination time; a REST surface provides the durable, auditable record for after-the-fact queries — audit reports, appeals, supervisory review, and state-to-federal reporting all require queryable records, not event replay
- Making Determination queryable resolves the single-source-of-truth question: Intake can reference a Decision by ID rather than storing a full copy of the outcome

**Options:**
- **(A)** ✓ Determination and Decision are exposed as queryable REST resources; `eligibility-openapi.yaml` defines GET endpoints for both; events still propagate outcomes to subscribers for real-time reactions
- **(B)** Determination and Decision are internal only; eligibility outcomes are available exclusively through events; consuming domains store their own projections

**Decision:** Option A is the correct answer for a domain that must support audit, appeals, and federal reporting. Option B pushes the burden of state management onto every consumer and reproduces the distributed consistency problem that #248 is already trying to solve.

---

### Decision 8: Eligibility trust boundary with Intake

**Status:** Decided: A

**What's being decided:** Whether Eligibility independently verifies that an application is complete and all verifications are resolved before running the rules engine, or whether it trusts Intake's signal that the application is ready for determination.

**Considerations:**
- Deciding whether verifications are complete enough to proceed is Intake's judgment to make — not Eligibility's; even if verification data is visible in the application payload Eligibility receives, re-evaluating completeness would duplicate Intake's decision-making authority, not just read its data
- The ready-for-determination signal is Intake's authoritative declaration that its process is done; treating it as a hint to double-check rather than a guarantee undermines the domain boundary and creates an implicit coupling between Eligibility's rules and Intake's internal verification model

**Options:**
- **(A)** ✓ Eligibility trusts the ready-for-determination signal as a guarantee that the application is complete; it runs the rules engine immediately without querying verification status
- **(B)** Eligibility independently queries Intake to confirm all verification items are resolved before running the rules engine

---

### Decision 9: Data exchange service call ownership

**Status:** Decided: A

**What's being decided:** Which domain — Intake or Eligibility — is responsible for initiating each category of data exchange service call, and on what basis.

**Considerations:**
- Some data exchange calls produce **verification evidence**: results that are stored against a verification item, reviewed by a caseworker, and used to satisfy or fail a document requirement. These belong in Intake because verification item ownership belongs there.
- Other data exchange calls feed directly into **determination logic**: results that are evaluated against program eligibility criteria (income thresholds, existing coverage) without producing a verification item or requiring caseworker review. These belong in Eligibility because they are part of the rules evaluation, not the data collection process.
- Mixing these responsibilities would mean Intake evaluates eligibility criteria (wrong domain) or Eligibility manages verification items (wrong domain).

**Options:**
- **(A)** ✓ Intake calls verification-oriented services (identity, citizenship, immigration status, income verification — results stored as evidence against verification items); Eligibility calls determination-oriented services (MAGI income threshold evaluation, existing coverage checks — results used directly in the rules engine)
- **(B)** One domain owns all data exchange calls and shares results with the other

**Decision:** Option A follows the domain boundary directly: each domain calls the services it needs to do its own job. Intake needs verification evidence to manage its verification items; Eligibility needs income and coverage data to evaluate MAGI criteria. Neither needs what the other calls.

---

### Decision 10: Notice of Action trigger

**Status:** Decided: B

**What's being decided:** Which event triggers the Notice of Action — whether the notice fires when the eligibility determination is complete or when intake closes the application.

**Considerations:**
- The NOA must wait until both determination paths have fully converged: the auto path (Medicaid RTE) and the manual path (caseworker review and optional supervisor approval); sending the notice before supervisor approval could mean notifying the applicant of an outcome that gets revised
- `eligibility.application.determination_completed` fires when all Decisions are resolved, but supervisor approval (when required by state policy) happens after this event on the manual path — there is no contracted `determination.approved` event from workflow to signal completion
- `intake.application.closed` is intake's authoritative signal that all post-determination steps are complete; both paths converge here with no new events required; state configurations without supervisor approval close immediately after `determination_completed`

**Options:**
- **(A)** `eligibility.application.determination_completed` — fires when all Decisions are resolved; but fires before supervisor approval on the manual path; requires a new `determination.approved` event to handle the approval gate
- **(B)** ✓ `intake.application.closed` — fires after all post-determination steps are complete; supervisor approval gates the close on the manual path; both paths converge cleanly; no new events needed

**Deferred:** Full implementation requires the Communications domain design (not yet designed) and an intake rule set that creates a notice resource at close. Tracked in #248.

---

### Decision 11: Eligibility rules engine scope

**Status:** Decided: B

**What's being decided:** Whether program eligibility rules — income thresholds, categorical eligibility criteria, household composition rules — are contracted as part of the baseline, or left to the state adapter to implement.

**Considerations:**
- Program eligibility criteria are highly program-specific, state-variable, and subject to federal regulatory changes; expressing them as contract artifacts would require the blueprint to maintain SNAP, Medicaid, and TANF rules for all possible state configurations and update them when regulations change
- Unlike intake and workflow rules (which define event orchestration — task creation, verification checklist generation, state machine transitions), eligibility evaluation rules involve complex income calculations, household composition logic, and program-specific criteria that differ substantially across states and programs
- States use a wide variety of rules engines in their existing systems: IBM Cúram rules framework, Pega decision tables, Drools, Corticon, and custom implementations; a contracted rules interface would constrain adapter implementation choices without adding value
- The blueprint's value in this domain is the data model (Determination, Decision), the API surface, and the event schema — not the program eligibility criteria themselves

**Options:**
- **(A)** Contract eligibility rules as YAML artifacts — portable but impractical at scale; requires the blueprint to maintain program criteria for every program and state configuration; rules content would need updates whenever regulations change
- **(B)** ✓ Rules engine is adapter-layer: the blueprint defines the inputs (Determination/Decision data model, event schema, API surface) and outputs (Decision status, path, denialReasonCode); program eligibility evaluation logic is the state adapter's responsibility

---

## Customization

### Baseline constraints

| Element | Reason | Decision |
|---|---|---|
| `Decision.path` field | Federal audit and CMS reporting requirement: ex parte determinations must be distinguishable from caseworker-reviewed determinations | [Decision 6](#decision-6-conditions-for-automatic-decision-resolution) |
| `Decision.denialReasonCode` | Required for the Notice of Action and the appeals record; removal would prevent the agency from meeting the written notice requirement (7 CFR § 273.2(h), 42 CFR § 435.917) | [Decision 2](#decision-2-determination-entity-model) |
| Medicaid auto-determination | Required by the ex parte rule — states must attempt RTE before involving a caseworker (42 CFR § 435.911) | [Decision 6](#decision-6-conditions-for-automatic-decision-resolution) |
| SNAP manual path | A caseworker interview is required before a SNAP determination; auto-determination for SNAP is not permitted under federal law (7 CFR § 273.2(e)) | [Decision 6](#decision-6-conditions-for-automatic-decision-resolution) |

### Determination and Decision entity fields

States may add fields to Determination and Decision to track state-specific data — for example, additional denial reason detail, program-specific flags, or audit annotations. Fields listed in [Baseline constraints](#baseline-constraints) may not be removed or renamed. All other baseline fields may be renamed to match state terminology via overlay.

### Submission-time electronic evaluation for non-Medicaid programs

The baseline runs electronic eligibility checks at submission only for Medicaid, where the federal ex parte rule requires it. States that want submission-time evaluation for SNAP, TANF, or other programs can overlay a rules configuration that queries additional data sources at submission and either resolves Decisions immediately or leaves them pending based on results. For determination-oriented checks — those that evaluate program eligibility criteria directly — results are stored in `Decision.electronicChecks`, which is structurally present on all Decisions; no schema change is required for that path. Verification-oriented checks at submission (producing evidence against a document requirement) remain Intake's responsibility per [Decision 9](#decision-9-data-exchange-service-call-ownership). See [Decision 4](#decision-4-submission-time-electronic-evaluation-scope) for why the baseline does not include this.

## Out of scope

| Capability | Domain | Notes |
|---|---|---|
| Benefit amount calculation | Benefits & Payments | Eligibility determines approved/denied; calculating the benefit amount (grant, allotment, benefit level) is a downstream function after determination |
| Ongoing redetermination (renewals, recertification) | Case Management | Triggered by an existing case nearing its review date, not by a new application submission; belongs in Case Management |
| Appeals and fair hearings | Appeals & Hearings | Review of adverse determination decisions; separate domain not yet designed |
| Application data collection and verification | Intake | Eligibility receives structured, verified data from Intake — it does not collect or verify it |
| Evidence tracking (documents linked to specific criteria) | Intake | Evidence collection and linkage to verification items is owned by Intake; Eligibility reads the completed record |
| Notice of Action generation | Communications | Eligibility supplies the determination result; the notice itself is assembled and sent by Communications |

## Capability coverage

### Determination

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Per-person per-program determinations | All major government benefits platforms (IBM Cúram, Salesforce Government Cloud, Pega) produce eligibility outcomes per member per program; required by 7 CFR § 273.2(h) and 42 CFR § 435.917, which mandate distinct written notices per person per program | **Planned** — see #275 |
| Medicaid RTE / ex parte auto-determination | Required by 42 CFR § 435.911 | **Planned** — see #275 |
| Expedited SNAP screening | Required by 7 CFR § 273.2(i) | **Planned** — see #275 |
| Denial reason codes | Required for NOA and appeals (7 CFR § 273.2(h), 42 CFR § 435.917) | **Planned** — see #275 |
| Determination path tracking (auto vs. manual) | Required for CMS reporting; distinguishes ex parte from caseworker-reviewed determinations | **Planned** — see #275 |
| Queryable Determination and Decision REST API | Required for audit, appeals, and federal reporting; avoids distributed state duplication across consumers | **Planned** — see [Decision 7](#decision-7-determination-rest-query-surface) and #275 |

### Submission-time evaluation

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Medicaid electronic evaluation at submission (ex parte) | Required by 42 CFR § 435.911 — electronic checks must be attempted before involving a caseworker | **Planned** — see #275 |
| Submission-time evaluation for SNAP and TANF | No federal mandate for these programs | **Not in scope** — state overlay option; see [Submission-time electronic evaluation for non-Medicaid programs](#submission-time-electronic-evaluation-for-non-medicaid-programs) |

### Rules engine

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Configurable program eligibility rules | Standard in government benefits platforms | **Adapter layer** — the blueprint defines the data model, API, and events; program eligibility criteria are the state adapter's responsibility. See [Decision 11](#decision-11-eligibility-rules-engine-scope) |
| Categorical eligibility (SSI linkage, TANF-linked categorical SNAP) | Regulatory option for SNAP (7 CFR § 273.2(j)) | **Adapter layer** — implemented in the state's rules engine. See [Decision 11](#decision-11-eligibility-rules-engine-scope) |
| Mixed-program household handling | Required by multi-program application support | **Planned** — covered by the per-person per-program Decision model |

## References

- **Regulatory:** 7 CFR § 273.2 (SNAP processing timelines and expedited screening), 42 CFR § 435.912 (Medicaid processing timelines), 42 CFR § 435.911 (Medicaid ex parte / real-time eligibility), 42 CFR § 435.916 (Medicaid renewal and ex parte redetermination), 42 CFR § 435.940–965 (Medicaid electronic verification)
- **Standards:** CloudEvents spec, MITA 3.0 eligibility framework
- **Related docs:** [Intake Domain](intake.md), [Data Exchange Domain](data-exchange.md), [Workflow Domain](workflow.md)
