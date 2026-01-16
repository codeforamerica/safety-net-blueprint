# Safety Net Benefits API Domain Design

Research and recommendations for organizing the Safety Net OpenAPI toolkit around domain-driven design principles.

> **Status: Proposed Architecture**
> This document describes the target domain organization. The current implementation includes only a subset of these domains (Intake with Applications and Persons). The remaining domains and entities are planned for future development.

---

## 1. Domain Organization

### Overview

The Safety Net Benefits API is organized into 7 domains, with Communication and Reporting as cross-cutting concerns:

| Domain | Purpose |
|--------|---------|
| **Client Management** | Persistent identity and relationships for people receiving benefits |
| **Intake** | Application submission from the client's perspective |
| **Eligibility** | Program-specific interpretation and determination |
| **Case Management** | Ongoing client relationships and staff assignments |
| **Workflow** | Work items, tasks, SLAs, and verification |
| **Scheduling** | Appointments and interviews |
| **Document Management** | Files and uploads |

**Cross-cutting concerns:**
- **Communication** - Notices and correspondence can originate from any domain (application received, documents needed, eligibility determined, appointment scheduled, etc.)
- **Reporting** - Each domain exposes data that reporting systems consume; audit events live where actions happen

### Domain Details

#### Client Management

Persistent information about people applying for or receiving benefits.

| Entity | Purpose |
|--------|---------|
| **Client** | Persistent identity - name, DOB, SSN, demographics (things that don't change often) |
| **Relationship** | Connections between clients - spouse, parent/child, sibling, etc. |
| **LivingArrangement** | Who the client reports living with (versioned over time) |
| **ContactInfo** | Addresses, phone numbers, email (may change but persists across applications) |
| **Income** | Stable income sources (SSI, SSDI, pensions, retirement, child support) - verified once, rarely changes |
| **Employer** | Past/current employers (optional, for pre-population) |

**Key decisions:**
- "Client" = people applying for or receiving benefits
- People mentioned on applications but not applying (absent parents, sponsors) are NOT persisted as Clients - they exist only in Intake
- Relationships are stored from the client's perspective
- Only persist financial data that is stable and provides pre-population value (stable income sources, employer history)
- Do NOT persist point-in-time eligibility data (vehicles, property, bank balances, expenses) - these belong in Intake

#### Intake

The application as the client experiences it - what they report.

| Entity | Purpose |
|--------|---------|
| **Application** | The submission requesting benefits |
| **Person** | People mentioned on the application (household members, absent parents, sponsors, etc.) |
| **Income** | Income the client claims |
| **Expense** | Expenses the client claims |
| **Resource** | Resources/assets the client claims |
| **LivingArrangement** | Who lives where, relationships as reported |

**Key decisions:**
- This is the "source of truth" for what the client told us
- Different types of people on an application:
  - **Household members** - people in the eligibility unit (seeking benefits)
  - **Other occupants** - live there but not part of benefits household
  - **Related parties** - absent parents, sponsors, non-custodial parents
  - **Representatives** - authorized representatives, application assisters
- Application is client-facing; eligibility interpretation happens in Eligibility domain

#### Eligibility

Program-specific interpretation of application data and benefit determination.

| Entity | Purpose |
|--------|---------|
| **EligibilityRequest** | A specific client + program being evaluated |
| **EligibilityUnit** | Program-specific grouping (e.g., SNAP "household", Medicaid "tax unit") |
| **Determination** | The outcome for a client + program |
| **Recertification** | Periodic re-evaluation of eligibility |
| **VerificationRequirement** | What a program requires to be verified and how |

**Key decisions:**
- "EligibilityUnit" is the entity; regulatory terms like "household" or "tax unit" appear in descriptions
- Eligibility happens at the intersection of: **who** (client) + **what** (program) + **when** (point in time)
- A single application may contain multiple clients applying for multiple programs - each combination gets its own EligibilityRequest
- Recertification lives here (re-determining eligibility)

#### Case Management

Ongoing client relationships and staff assignments. **[Detailed schemas →](domains/case-management.md)**

| Entity | Purpose |
|--------|---------|
| **Case** | The ongoing relationship with a client/household |
| **CaseWorker** | Staff member who processes applications |
| **Supervisor** | Extends CaseWorker with approval authority, team capacity, escalation handling |
| **Office** | Geographic or organizational unit (county, regional, state) |
| **Assignment** | Who is responsible for what |
| **Caseload** | Workload for a case worker |
| **Team** | Group of case workers |

**Key decisions:**
- Case Management is about relationships: "Who's handling this? What's the history?"
- Office enables geographic routing and reporting by county/region
- Separate from Workflow (which is about work items)

#### Workflow

Work items, tasks, and SLA tracking. **[Detailed schemas →](domains/workflow.md)**

| Entity | Purpose |
|--------|---------|
| **Task** | A work item requiring action |
| **Queue** | Organizes tasks by team, county, program, or skill |
| **WorkflowRule** | Defines automatic task routing and prioritization logic |
| **VerificationTask** | Task to verify data - either validation (accuracy) or program verification (evidence standards) |
| **VerificationSource** | External services/APIs for data validation (IRS, ADP, state databases) |
| **TaskAuditEvent** | Immutable audit trail |

**Key decisions:**
- Workflow is about work items: "What needs to be done? Is it on track?"
- Queues organize tasks for routing and monitoring
- WorkflowRules enable automatic task routing and prioritization based on program, office, skills, and client attributes
- Verification has two purposes:
  - **Data validation**: Is the intake data accurate? (check against external sources)
  - **Program verification**: Does the data meet program evidence standards?
- VerificationTask connects Intake data → External Sources → Eligibility requirements
- Tasks are assigned to CaseWorkers (connects to Case Management)

#### Communication (Cross-Cutting)

Official notices and correspondence that can originate from any domain. **[Detailed schemas →](cross-cutting/communication.md)**

| Entity | Purpose |
|--------|---------|
| **Notice** | Official communication (approval, denial, RFI, etc.) |
| **Correspondence** | Other communications |
| **DeliveryRecord** | Tracking of delivery status |

**Key decisions:**
- Communication is cross-cutting because notices can be triggered by events in any domain:
  - Intake: "Application received"
  - Eligibility: "Approved", "Denied", "Request for information"
  - Workflow: "Documents needed", "Interview scheduled"
  - Case Management: "Case worker assigned"
- Entities live in a Communication domain but are consumed/triggered by all domains

#### Scheduling

Time-based coordination.

| Entity | Purpose |
|--------|---------|
| **Appointment** | Scheduled meeting |
| **Interview** | Required interview for eligibility |
| **Reminder** | Notification of upcoming events |

#### Document Management

Files and uploads.

| Entity | Purpose |
|--------|---------|
| **Document** | Metadata about a document |
| **Upload** | The actual file |

---

## 2. Data Flow Between Domains

```
                        ╔═══════════════════════════════════════════════════╗
                        ║  CROSS-CUTTING: Communication, Reporting          ║
                        ╚═══════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT PERSPECTIVE                          │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  INTAKE                                                             │
│  Application, Person, Income, Expense, Resource, LivingArrangement  │
│  "What the client told us"                                          │
└─────────────────────────────────────────────────────────────────────┘
                    │                           │
                    ▼                           │
      ┌───────────────────────────────┐         │
      │  CLIENT MANAGEMENT            │         │
      │  Client, Relationship,        │         │
      │  LivingArrangement, Income    │         │
      │  "Persist people seeking      │         │
      │   benefits"                   │         │
      └───────────────────────────────┘         │
                                                │
       ┌────────────────────────────────────────┤
       │                                        │
       │ (SNAP, TANF)                           │ (MAGI Medicaid -
       │ Caseworker review                      │  automated path)
       ▼                                        │
┌───────────────────────────────┐               │
│  CASE MANAGEMENT              │               │
│  Case, CaseWorker, Supervisor,│               │
│  Assignment, Caseload         │               │
│  "Who's responsible"          │               │
└───────────────────────────────┘               │
       │                                        │
       ▼                                        ▼
┌───────────────────────────────┐   ┌─────────────────────────────────┐
│  WORKFLOW                     │   │  ELIGIBILITY                    │
│  Task, VerificationTask,      │──▶│  EligibilityRequest,            │
│  SLA, TaskAuditEvent          │   │  EligibilityUnit, Determination │
│  "What work needs to be done" │◀──│  "Program-specific              │
└───────────────────────────────┘   │   interpretation"               │
                                    └─────────────────────────────────┘
```

**Flow notes:**
- Intake data flows to Client Management (persist clients) and feeds into Eligibility
- Case workers are typically assigned to review intake data before eligibility determination
- Workflow tasks support the eligibility process (verification, document review)
- **MAGI Medicaid** can often be determined automatically without caseworker involvement (no asset test, standardized income rules, electronic data verification)
- **SNAP and TANF** typically require caseworker review due to asset tests, complex household rules, and interview requirements

---

## 3. Safety Net Specific Concerns

### Regulatory/Compliance

| Concern | Example |
|---------|---------|
| **Mandated timelines** | SNAP: 30-day processing, 7-day expedited; Medicaid: 45-day determination |
| **SLA tracking** | Federal reporting on timeliness rates |
| **Audit trails** | Everything must be documented for federal audits |
| **Notice requirements** | Specific notices at specific points (denial, approval, RFI) |

### Multi-Program Complexity

| Concern | Example |
|---------|---------|
| **One application, multiple programs** | Client applies for SNAP, Medicaid, and TANF together |
| **Multiple clients per application** | Household members each applying for different programs |
| **Program-specific households** | SNAP household ≠ Medicaid tax unit ≠ IRS household |
| **Different timelines per program** | SNAP 30-day vs Medicaid 45-day |

### Operational

| Concern | Example |
|---------|---------|
| **Document verification** | Tasks to verify income, identity, residency (program-specific) |
| **Request for Information (RFI)** | Client has X days to respond before adverse action |
| **Inter-agency handoffs** | Tasks may transfer between county offices, state agencies |
| **Accommodations** | Language, disability, or other special handling flags |
| **Caseload management** | Assigning/balancing work across case workers |
| **Recertification** | Periodic re-evaluation of eligibility |
| **Appeals** | Formal appeal processes with their own timelines |

### Privacy

| Concern | Example |
|---------|---------|
| **PII protection** | All domains contain sensitive information |
| **Role-based access** | Different visibility for workers, supervisors, auditors |

---

## 4. Detailed Schemas

Detailed schemas have been moved to domain-specific files for better organization:

| Domain | File |
|--------|------|
| Workflow | [domains/workflow.md](domains/workflow.md) |
| Case Management | [domains/case-management.md](domains/case-management.md) |
| Communication | [cross-cutting/communication.md](cross-cutting/communication.md) |

*Note: Client Management, Intake, Eligibility, Scheduling, and Document Management schemas will be added as those domains are implemented.*

---

## 5. Design Decisions

### Decision Log

Key decisions made during design, with alternatives considered. These are **proposed decisions** - review and adjust before implementation.

> **How to use this log**: Each decision includes the options we considered and why we chose one over others. If circumstances change or new information emerges, revisit the rationale to determine if a different choice makes more sense.

---

**Where does Application live?**

| Option | Considered | Chosen |
|--------|------------|--------|
| Intake | Application captures what the client reports | Yes |
| Eligibility | Application is fundamentally about determining eligibility | No |
| Case Management | Application is one event in a larger case lifecycle | No |

*Rationale*: Application is the client's perspective - what they told us. Eligibility interprets that data per program rules. Case Management tracks the ongoing relationship across multiple applications.

*Reconsider if*: Applications become tightly coupled to eligibility rules rather than being a neutral record of client-reported data.

---

**How to handle living arrangements and eligibility groupings?**

| Option | Considered | Chosen |
|--------|------------|--------|
| Single "Household" entity | Simple, but conflates factual and regulatory concepts | No |
| Snapshots only | Each application captures composition at that moment | Partially |
| Split: LivingArrangement + EligibilityUnit | Factual data persists; programs interpret into eligibility units | Yes |

*Rationale*: "Household" is a regulatory term with different meanings per program (IRS, SNAP, Medicaid). We use `LivingArrangement` for the factual "who do you live with" data (in Client Management and Intake), and `EligibilityUnit` for program-specific groupings (in Eligibility). Regulatory terms like "household" or "tax unit" appear in descriptions.

*Reconsider if*: Living arrangement changes are infrequent and the complexity of tracking both isn't justified, or if all programs use the same grouping rules.

---

**Is Income its own domain?**

| Option | Considered | Chosen |
|--------|------------|--------|
| Own domain | Complex enough to warrant separation | No |
| Part of Eligibility | Only useful for eligibility | No |
| Split: Income (Intake) + verified income (Eligibility) | Matches reported vs interpreted pattern | Yes |

*Rationale*: Follows the same pattern as household - what client reports vs how programs interpret it.

*Reconsider if*: Income tracking becomes significantly more complex (e.g., real-time income verification, multiple income sources with independent lifecycles) and warrants dedicated APIs.

---

**Case Management vs Workflow: one or two domains?**

| Option | Considered | Chosen |
|--------|------------|--------|
| Combined | Simpler, fewer domains | No |
| Separate | Clear separation of concerns | Yes |

*Rationale*: They answer different questions. Workflow = "What needs to be done?" Case Management = "Who's responsible for this relationship?"

*Reconsider if*: The separation creates too much complexity in practice, or if case workers primarily interact with the system through tasks (making them effectively the same).

---

**Where does Verification live?**

| Option | Considered | Chosen |
|--------|------------|--------|
| Own domain | Verification is complex | No |
| Part of Workflow | Verification is work that needs to be done | Yes |
| Part of Case Management | Case workers do verification | No |

*Rationale*: Verification tasks are work items with SLAs and outcomes - fits naturally with Workflow.

*Reconsider if*: Verification becomes a complex subsystem with its own rules engine, third-party integrations, and document processing pipelines.

---

**Is Reporting its own domain?**

| Option | Considered | Chosen |
|--------|------------|--------|
| Own domain | Could hold report definitions, metrics | No |
| Cross-cutting concern | Aggregates data from all domains | Yes |

*Rationale*: Reporting doesn't own entities - it consumes data from other domains. Audit events live where actions happen.

*Reconsider if*: Federal reporting requirements become complex enough to warrant standardized report definitions, scheduling, and delivery tracking as first-class entities.

---

**Terminology: what to call people receiving benefits?**

| Option | Considered | Chosen |
|--------|------------|--------|
| Person | Generic | No |
| Client | Common in social work | Yes |
| Participant | Common in federal programs | No |
| Beneficiary | Implies already receiving benefits | No |

*Rationale*: "Client" is widely used in social services and clearly indicates someone the agency serves.

*Reconsider if*: Integrating with systems that use different terminology (e.g., "participant" in federal systems) and alignment is important.

---

**What financial data belongs in Client Management vs Intake?**

| Option | Considered | Chosen |
|--------|------------|--------|
| All in Intake | Simpler, fresh data each application | No |
| All in Client Management | Maximum pre-population | No |
| Split by stability | Stable income persists; point-in-time data in Intake | Yes |

**Persist in Client Management:**
- Income (SSI, SSDI, pensions, retirement, child support) - verified once, rarely changes
- Employer - useful for pre-population

**Keep in Intake (point-in-time):**
- Income (current wages/earnings)
- Resource (vehicles, property, bank balances)
- Expense (rent, utilities)

*Rationale*: Only persist data that (1) is verified once and rarely changes, (2) provides real value for pre-populating future applications, and (3) is useful for case workers to see across applications. Assets and expenses are only used for point-in-time eligibility determination - there's no value in persisting them beyond the application.

*Reconsider if*: There's a need to track asset/expense changes over time for fraud detection, or if pre-populating assets significantly reduces client burden and error rates.

---

**Should entities have distinct names across domains?**

| Option | Considered | Chosen |
|--------|------------|--------|
| Distinct names per domain | Self-documenting, explicit | No |
| Same name, domain provides context | Simpler, less cognitive load | Yes |

*Rationale*: If entities are organized under domains with distinct API paths, the domain context already provides disambiguation. Using the same name (`Income`) in both Client Management and Intake is simpler and more natural. The path tells you the difference: `/clients/{id}/income` vs `/applications/{id}/income`.

*Reconsider if*: Developers frequently work across domains and find the shared naming confusing, or if schemas need to be referenced in a shared context where domain isn't clear.

---

**Explicit Tasks vs Workflow Engine?**

| Option | Considered | Chosen |
|--------|------------|--------|
| Explicit Task entities | Simple, flexible, follows existing patterns | Yes |
| BPMN workflow engine | Declarative, visual modeling | No |

*Rationale*: Explicit tasks are simpler and sufficient for v1. A workflow engine can be layered on top later if needed.

*Reconsider if*: Workflows become complex enough that declarative definitions and visual modeling would significantly reduce implementation effort, or if non-developers need to modify workflows.

---

### Domain Separation

| Decision | Rationale |
|----------|-----------|
| **Client Management separate from Intake** | Clients persist across applications; Intake is per-submission |
| **Eligibility separate from Intake** | Client reports data; Eligibility interprets it per program rules |
| **Case Management separate from Workflow** | Case Management = relationships; Workflow = work items |
| **Verification in Workflow** | Verification is work that needs to be done |
| **Reporting is cross-cutting** | Not a domain; aggregates from other domains |

### Naming Conventions

| Convention | Example |
|------------|---------|
| **Entity names** | Singular: `Client`, `Income`, `Task` |
| **API paths** | Plural: `/clients`, `/income`, `/tasks` |
| **Same name across domains** | `Income` in Client Management and `Income` in Intake - domain provides context |

Entities with the same name in different domains represent the same concept, distinguished by context:
- `Income` in Client Management = stable, persistent income sources
- `Income` in Intake = point-in-time reported income for this application

### Key Terminology

| Term | Definition |
|------|------------|
| **Client** | A person applying for or receiving benefits (persisted) |
| **LivingArrangement** | Who the client reports living with (factual) |
| **EligibilityUnit** | Program-specific grouping for eligibility (e.g., SNAP "household", Medicaid "tax unit") |
| **Application** | The submission from the client's perspective |
| **EligibilityRequest** | Evaluation of a specific client + program |
| **Determination** | The eligibility outcome for a client + program |
| **Task** | A work item requiring action |
| **Case** | Ongoing relationship with a client |

---

## 6. Migration Considerations

### Current Schema Mapping

| Current Entity | Proposed Domain | Proposed Entity | Notes |
|----------------|-----------------|-----------------|-------|
| Person | Client Management | Client | Rename - "Client" indicates someone we serve |
| Household | Split | LivingArrangement (Client Mgmt/Intake) + EligibilityUnit (Eligibility) | Separate factual from regulatory |
| Application | Intake | Application | Move to Intake domain |
| HouseholdMember | Intake | Person | Simplify name, domain provides context |
| Income | Split | Income (Client Mgmt - stable) + Income (Intake - reported) | Split by stability |

### New Entities Needed

| Entity | Domain | Priority |
|--------|--------|----------|
| Task | Workflow | High |
| CaseWorker | Case Management | High |
| Supervisor | Case Management (extends CaseWorker) | High |
| Notice | Communication | High |
| Case | Case Management | Medium |
| EligibilityRequest | Eligibility | Medium |
| EligibilityUnit | Eligibility | Medium |
| Determination | Eligibility | Medium |
| LivingArrangement | Client Management / Intake | Medium |
| Appointment | Scheduling | Low |
| Document | Document Management | Low |

---

## 7. Implementation Phases

### Phase 1: Workflow & Case Management (Priority)
1. Create Workflow domain (Task, VerificationTask, TaskAuditEvent)
2. Create Case Management domain (CaseWorker, Assignment)
3. Create Communication entities (Notice) - cross-cutting, consumed by multiple domains

### Phase 2: Domain Reorganization
1. Restructure existing schemas into domain folders
2. Create Client Management domain (rename Person → Client)
3. Create Intake domain (reorganize Application)
4. Create Eligibility domain (EligibilityUnit, EligibilityRequest, Determination)

### Phase 3: Additional Domains
1. Create Scheduling domain
2. Create Document Management domain

---

## 8. Future Considerations

Potential domains and functionality not included in the current design, for future evaluation.

### High Priority

**Benefits/Issuance**
- Benefit amounts and calculations
- EBT card issuance and management
- Payment tracking
- Benefit history and adjustments

*Rationale*: Core to safety net programs - what happens after eligibility is determined. Currently out of scope but essential for end-to-end benefits administration.

**Appeals**
- Appeal requests
- Fair hearing scheduling
- Hearing outcomes and decisions
- Appeal workflow (distinct from standard eligibility workflow)

*Rationale*: Required by law for all safety net programs. Has distinct workflow, timelines, and participants (hearing officers). Currently only represented as task types.

### Medium Priority

**Staffing Forecasting**
- Project task volume based on historical patterns and upcoming deadlines
- Calculate required staff hours vs current capacity
- Identify staffing gaps by office, queue, or program
- Potential entities: `StaffingForecast`, `DeadlineProjection`

*Rationale*: Helps supervisors plan staffing during surges and avoid SLA breaches. Depends on mature Task and Caseload data to be useful.

**Change Reporting**
- Mid-certification changes reported by clients
- Change processing and verification
- Impact assessment on current benefits
- Change-triggered recertifications

*Rationale*: Common client interaction between certifications. Changes can affect eligibility and benefit amounts. Related to but distinct from Intake (not a new application).

**Programs**
- Program definitions (SNAP, TANF, Medicaid, etc.)
- Eligibility rules and criteria
- Income/asset limits
- Deduction rules
- Program-specific configurations

*Rationale*: Reference data needed across all domains. Currently assumed but not explicitly modeled. Could be configuration vs. a domain.

### Low Priority

**Fraud/Integrity**
- Fraud investigations
- Overpayment identification and tracking
- Recovery efforts
- Intentional Program Violations (IPVs)
- Disqualification periods

*Rationale*: Important for program integrity but specialized function. Often handled by separate units with different workflows.

**Referrals**
- Referrals to other services (employment, housing, childcare)
- Partner agency connections
- Community resource linking
- Referral tracking and outcomes

*Rationale*: Valuable for holistic client support but secondary to core benefits administration. May vary significantly by state/agency.

**Provider Management**
- Healthcare providers (Medicaid)
- SNAP authorized retailers
- TANF service providers
- Provider enrollment and verification

*Rationale*: Program-specific (primarily Medicaid). Often managed by separate systems. Complex enough to be its own domain.

**Quality Assurance**
- Case reviews and audits
- Error tracking and categorization
- Corrective action plans
- Federal reporting metrics (timeliness, accuracy)

*Rationale*: Important for compliance but often aggregated from other domains. May be better as cross-cutting reporting than a separate domain.

---

## 9. References

### Existing Files

- `packages/schemas/openapi/applications.yaml` - Current Application API
- `packages/schemas/openapi/components/application.yaml` - Current Application schema
- `packages/schemas/openapi/components/person.yaml` - Current Person schema
- `packages/schemas/openapi/components/common.yaml` - Shared schemas
- `packages/schemas/openapi/patterns/api-patterns.yaml` - API conventions
