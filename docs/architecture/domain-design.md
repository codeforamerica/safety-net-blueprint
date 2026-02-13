# Domain Design

> **Status: Work in progress** — Domain organization is still evolving based on research and feedback. See the domain table below for per-domain design status.

Domain organization, entities, data flow, and safety net specific concerns for the Safety Net Benefits API.

See also: [API Architecture](api-architecture.md) | [Design Rationale](design-rationale.md) | [Roadmap](roadmap.md)

---

## 1. Domain Organization

### Overview

The Safety Net Benefits API is organized into 7 domains, with 4 cross-cutting concerns:

| Domain | Design Status | Purpose |
|--------|---------------|---------|
| **Client Management** | Not started | Persistent identity and relationships for people receiving benefits |
| **Intake** | Partial | Application submission from the client's perspective |
| **Eligibility** | Not started | Program-specific interpretation and determination |
| **Case Management** | Partial | Ongoing client relationships and staff assignments |
| **Workflow** | Partial (pending approval) | Work items, tasks, SLAs, and verification |
| **Scheduling** | Not started | Appointments and interviews |
| **Document Management** | Not started | Files and uploads |

**Cross-cutting concerns:**
- **Communication** - Notices and correspondence can originate from any domain (application received, documents needed, eligibility determined, appointment scheduled, etc.)
- **Reporting** - Each domain exposes data that reporting systems consume; audit events live where actions happen
- **Configuration Management** - Business-configurable rules, thresholds, and settings that can be changed without code deployments
- **Observability** - Health checks, metrics, logging, and tracing for operations staff

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

The application as the client experiences it — what they report. See the [application review prototype](../prototypes/application-review-prototype.md) for the proven subset.

| Entity | Purpose |
|--------|---------|
| **Application** | The submission requesting benefits, with programs applied for |
| **ApplicationMember** | People on the application — with relationship, programs applying for, citizenship info, tax filing info |
| **Income** | Income sources per member (employed, self-employed, unearned) |
| **Expense** | Expenses the client claims |
| **Resource** | Resources/assets the client claims |

**Key decisions:**
- This is the "source of truth" for what the client told us
- ApplicationMember captures different types of people on an application (household members, other occupants, related parties, representatives) via the `relationship` field
- Each member specifies which programs they are applying for (`programsApplyingFor`), which drives form definition rendering and section review creation
- Application is client-facing; eligibility interpretation happens in Eligibility domain

#### Eligibility

Program-specific interpretation of application data and benefit determination.

| Entity | Purpose |
|--------|---------|
| **EligibilityRequest** | An evaluation of a client + program (initial, recertification, or change) |
| **EligibilityUnit** | Program-specific grouping (e.g., SNAP "household", Medicaid "tax unit") |
| **Determination** | The outcome for a client + program |
| **VerificationRequirement** | What a program requires to be verified and how |

**Key decisions:**
- `EligibilityRequest` handles all evaluation types via `requestType`: initial applications, scheduled recertifications, client-initiated renewals, and mid-certification changes
- "EligibilityUnit" is the entity; regulatory terms like "household" or "tax unit" appear in descriptions
- Eligibility happens at the intersection of: **who** (client) + **what** (program) + **when** (point in time)
- A single application may contain multiple clients applying for multiple programs - each combination gets its own EligibilityRequest
- Recertifications link to the previous Determination, creating a history chain

#### Case Management

Ongoing client relationships and staff assignments. **[Details →](domains/case-management.md)**

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

Work items, tasks, and SLA tracking. **[Details →](domains/workflow.md)**

| Entity | Purpose |
|--------|---------|
| **Task** | A work item requiring action |
| **Queue** | Organizes tasks by team, county, program, or skill |
| **SLAType** | Configuration for SLA deadlines by program and task type |
| **TaskType** | Configuration for task categories with default SLA and skills |
| **VerificationTask** | Task to verify data — either validation (accuracy) or program verification (evidence standards) |
| **VerificationSource** | External services/APIs for data validation (IRS, ADP, state databases) |
| **TaskAuditEvent** | Immutable audit trail |

**Key decisions:**
- Workflow is about work items: "What needs to be done? Is it on track?"
- Queues organize tasks for routing and monitoring
- Routing and priority rules are defined as decision tables in the [rules YAML contract artifact](contract-driven-architecture.md#rules), not as CRUD entities — the state machine invokes them via `evaluate-rules` effects
- Verification has two purposes:
  - **Data validation**: Is the intake data accurate? (check against external sources)
  - **Program verification**: Does the data meet program evidence standards?
- VerificationTask connects Intake data → External Sources → Eligibility requirements
- Tasks are assigned to CaseWorkers (connects to Case Management)

#### Communication (Cross-Cutting)

Official notices and correspondence that can originate from any domain. **[Details →](cross-cutting/communication.md)**

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
╔═════════════════════════════════════════════════════════════════════════════╗
║  CROSS-CUTTING: Communication, Reporting, Configuration Mgmt, Observability ║
╚═════════════════════════════════════════════════════════════════════════════╝

┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT PERSPECTIVE                          │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  INTAKE                                                             │
│  Application, ApplicationMember, Income, Expense, Resource          │
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
│  SLAType, TaskAuditEvent      │   │  EligibilityUnit, Determination │
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

## 4. Domain Details

Domain-specific design has been moved to separate files:

| Domain | File |
|--------|------|
| Workflow | [domains/workflow.md](domains/workflow.md) |
| Case Management | [domains/case-management.md](domains/case-management.md) |
| Communication | [cross-cutting/communication.md](cross-cutting/communication.md) |

*Note: Client Management, Intake, Eligibility, Scheduling, and Document Management will be added as those domains are designed. Reporting aggregates data from other domains and doesn't have its own design doc.*

For operational concerns (Configuration Management, Observability), see [API Architecture](api-architecture.md).

---

## Related Documents

| Document | Description |
|----------|-------------|
| [Contract-Driven Architecture](contract-driven-architecture.md) | Contract artifacts for backend and frontend portability |
| [API Architecture](api-architecture.md) | API organization, vendor independence, operational architecture |
| [Design Rationale](design-rationale.md) | Key decisions with rationale and alternatives |
| [Roadmap](roadmap.md) | Implementation phases, prototypes, future considerations |
| [api-patterns.yaml](../../packages/contracts/patterns/api-patterns.yaml) | Machine-readable API design patterns |
