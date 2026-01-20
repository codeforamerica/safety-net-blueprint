# Safety Net Benefits API Domain Design

Research and recommendations for organizing the Safety Net OpenAPI toolkit around domain-driven design principles.

> **Status: Proposed Architecture**
> This document describes the target domain organization. The current implementation includes only a subset of these domains (Intake with Applications and Persons). The remaining domains and entities are planned for future development.

---

## 1. Domain Organization

### Overview

The Safety Net Benefits API is organized into 7 domains, with 4 cross-cutting concerns:

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
| Configuration Management | See [Section 7: Operational Architecture](#7-operational-architecture) |
| Observability | See [Section 7: Operational Architecture](#7-operational-architecture) |

*Note: Client Management, Intake, Eligibility, Scheduling, and Document Management schemas will be added as those domains are implemented. Reporting aggregates data from other domains and doesn't have its own schemas.*

---

## 5. API Layer Organization

Following API-led connectivity principles, APIs are organized into layers.

### System APIs vs Process APIs

| Layer | Purpose | Style | Example |
|-------|---------|-------|---------|
| **System APIs** | Direct access to domain data | RESTful CRUD | `GET /tasks/{id}`, `POST /applications` |
| **Process APIs** | Orchestrate business operations | RPC-style actions | `POST /processes/applications/submit` |

**Key distinctions:**
- **System APIs** own canonical schemas and provide granular CRUD operations on resources
- **Process APIs** call multiple System APIs to perform business operations; they don't access data directly
- Process APIs define purpose-built request/response DTOs optimized for specific use cases

### Folder Structure

```
openapi/
├── domains/                              # System APIs (resource-based)
│   ├── workflow/
│   │   ├── tasks.yaml
│   │   ├── queues.yaml
│   │   └── components/schemas.yaml       # Canonical schemas
│   ├── case-management/
│   ├── intake/
│   └── eligibility/
│
├── processes/                            # Process API contracts (use-case-based)
│   ├── applications/
│   │   ├── submit.yaml
│   │   └── withdraw.yaml
│   ├── eligibility/
│   │   └── determine.yaml
│   ├── tasks/
│   │   └── bulk-reassign.yaml
│   └── components/schemas.yaml           # Process-specific DTOs
│
└── components/                           # Shared primitives (Address, Name, etc.)
```

### Process API Organization

Process APIs are organized **by capability** (not by actor), with actor metadata:

```yaml
# processes/applications/submit.yaml
x-actors: [client, caseworker]    # Who can call this
x-capability: application-intake
```

### What This Repo Provides

| Asset | Purpose | State Usage |
|-------|---------|-------------|
| Domain architecture | Patterns, entity relationships, terminology | Adopt/adapt |
| System API specs | Base schemas + overlay support | Extend via overlays |
| Process API contracts | Interface definitions (inputs/outputs) | Implement against |
| Mock System APIs | Testing tool | Use for development/testing |
| Reference implementations | Educational examples (TypeScript) | Learn from, don't extend |

**Important:** Reference implementations are examples, not production code to extend. States implement Process APIs from the contracts in their preferred language.

### Mock Server Scope

The mock server provides dynamic responses for **System APIs only**:
- Reads OpenAPI specs and examples
- Maintains mock database state
- Supports CRUD operations

Process APIs are **not mocked** because:
- Process APIs are orchestration logic—that's what you want to test
- Real Process API implementations call mock System APIs during development
- States implement Process APIs; this repo provides the contracts

---

## 6. Vendor Independence

This architecture helps states avoid vendor lock-in when procuring backend systems (workflow management, case management, etc.).

### Adapter Pattern

```
┌─────────────────────────────────────────────────────────┐
│  Process APIs (state's business logic)                  │
│  - Implements eligibility, orchestration                │
│  - Calls System API contracts, NOT vendor APIs          │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  System API Contracts (this repo's OpenAPI specs)       │
│  - Canonical domain model (Task, Case, Application)     │
│  - Vendor-agnostic interface                            │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Adapter Layer (thin, replaceable)                      │
│  - Maps vendor data ↔ canonical model                   │
│  - Implements System API contract                       │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Vendor System (workflow tool, case mgmt, etc.)         │
└─────────────────────────────────────────────────────────┘
```

### Impact of Switching Vendors

| Layer | Impact |
|-------|--------|
| Process APIs | No change |
| System API Contracts | No change |
| Adapter Layer | Rewrite for new vendor |
| Vendor System | Replace |

### Guidance for States

1. **Never call vendor APIs directly from Process APIs** - always go through the System API layer
2. **Keep adapters thin** - translation only, no business logic
3. **Domain model is source of truth** - vendor models map to yours, not vice versa
4. **Test against mocks** - proves your code isn't secretly coupled to a vendor

---

## 7. Operational Architecture

### Configuration Management

**Principle:** If a policy analyst needs to change it, it's configuration. If a developer needs to change it, it's code.

**Business-configurable settings:**

| Configurable | Example | Changed By |
|--------------|---------|------------|
| Workflow rules | Assignment rules, priority rules | Program managers |
| Eligibility thresholds | Income limits, asset limits, FPL percentages | Policy analysts |
| SLA timelines | Days to process, warning thresholds | Operations managers |
| Notice templates | Content, formatting | Communications staff |
| Feature flags | Enable/disable programs, pilots | Product owners |
| Business calendars | Holidays, office hours | Office managers |

**Architecture:**

```
┌─────────────────────────────────────────────┐
│  Admin UI (for business users)              │
└───────────────────────┬─────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────┐
│  Admin/Config APIs                          │
│  - GET/PUT /config/eligibility-thresholds   │
│  - GET/PUT /config/workflow-rules           │
│  - GET/PUT /config/sla-settings             │
└───────────────────────┬─────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────┐
│  Config Store (versioned, audited)          │
└─────────────────────────────────────────────┘
```

**Key requirements:**
- All configuration changes are audited (who changed what, when)
- Configuration is versioned (rollback capability)
- Changes take effect without deployment
- Validation prevents invalid configurations

### Observability

**For operations staff to monitor and support the APIs:**

| Capability | Purpose | Standard |
|------------|---------|----------|
| Health endpoints | Is the system up? | `GET /health`, `GET /ready` |
| Metrics | Request rates, latencies, error rates | Prometheus format |
| Structured logging | Searchable, consistent format | JSON with correlation IDs |
| Distributed tracing | Follow requests across APIs | OpenTelemetry |
| Audit logs | Who did what when | Domain events (e.g., TaskAuditEvent) |
| Alerting hooks | Integration with incident management | Webhooks, PagerDuty, etc. |

**Standard endpoints for all APIs:**

```yaml
/health:
  get:
    summary: Liveness check
    responses:
      200: { description: Service is running }

/ready:
  get:
    summary: Readiness check (dependencies healthy)
    responses:
      200: { description: Service is ready to accept traffic }
      503: { description: Service is not ready }

/metrics:
  get:
    summary: Prometheus metrics
    responses:
      200: { description: Metrics in Prometheus format }
```

**Logging standards:**
- All logs include correlation ID for request tracing
- Structured JSON format for searchability
- Standard fields: timestamp, level, service, correlationId, message
- PII is masked or excluded from logs

---

## 8. Design Decisions

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

**System APIs vs Process APIs?**

| Option | Considered | Chosen |
|--------|------------|--------|
| Single API layer | Simpler, fewer moving parts | No |
| Two layers (System + Process) | Clear separation of data access vs orchestration | Yes |

*Rationale*: System APIs provide RESTful CRUD access to domain data. Process APIs orchestrate business operations by calling System APIs. This separation means Process APIs contain business logic while System APIs remain simple and reusable.

*Reconsider if*: The overhead of maintaining two layers isn't justified by the complexity of the business processes, or if most operations map 1:1 to CRUD actions.

---

**What should the mock server cover?**

| Option | Considered | Chosen |
|--------|------------|--------|
| All APIs | Complete testing environment | No |
| System APIs only | Mock data layer, test real orchestration | Yes |

*Rationale*: Process APIs are orchestration logic—that's what you want to test. Mocking them defeats the purpose. Real Process API implementations call mock System APIs during development.

*Reconsider if*: Teams need to develop against Process APIs before implementations exist, or if Process API behavior is complex enough to warrant contract testing via mocks.

---

**How to organize Process APIs?**

| Option | Considered | Chosen |
|--------|------------|--------|
| By actor (client/, caseworker/, admin/) | Intuitive grouping by who uses it | No |
| By capability (applications/, eligibility/, tasks/) | Actor-agnostic, same operation available to multiple actors | Yes |

*Rationale*: Many operations are used by multiple actors (e.g., both clients and caseworkers can submit applications). Organizing by capability with actor metadata (`x-actors: [client, caseworker]`) avoids duplication.

*Reconsider if*: Actor-specific behavior diverges significantly (different request/response shapes), making shared endpoints awkward.

---

**What is the purpose of reference implementations?**

| Option | Considered | Chosen |
|--------|------------|--------|
| Production-ready code to extend | States fork and customize | No |
| Educational examples | States learn patterns, implement from scratch | Yes |

*Rationale*: Reference implementations demonstrate how to implement Process APIs against System API contracts. States implement in their preferred language/framework. Extending reference code creates maintenance burden and hidden coupling.

*Reconsider if*: Implementation patterns are complex enough that reference code provides significant value, or if a common framework emerges across states.

---

**How to achieve vendor independence?**

| Option | Considered | Chosen |
|--------|------------|--------|
| Standardize on specific vendors | Simpler, less abstraction | No |
| Adapter pattern | Thin translation layer between contracts and vendors | Yes |

*Rationale*: Process APIs call System API contracts, not vendor APIs directly. Adapters translate between canonical models and vendor-specific implementations. Switching vendors means rewriting adapters, not business logic.

*Reconsider if*: Vendor capabilities diverge so significantly that adapters become complex business logic themselves.

---

**What's configurable vs code?**

| Option | Considered | Chosen |
|--------|------------|--------|
| Everything in code | Simpler deployment, version controlled | No |
| Split by who changes it | Policy analyst changes = config; developer changes = code | Yes |

*Rationale*: Workflow rules, eligibility thresholds, SLA timelines, and notice templates change frequently and shouldn't require deployments. Business users can adjust these through Admin APIs. Configuration is versioned and audited.

*Reconsider if*: Configuration complexity grows to the point where it's effectively code, or if audit/versioning requirements are better served by version control.

---

**Should there be an Experience Layer?**

| Option | Considered | Chosen |
|--------|------------|--------|
| Experience Layer now | Tailored APIs for each client type (mobile, web, caseworker portal) | No |
| Process APIs serve all clients | Clients call Process APIs directly | Yes |
| GraphQL in the future | Flexible querying when client needs diverge | Deferred |

*What is an Experience Layer?* An Experience Layer (sometimes called "Backend for Frontend" or BFF) is an API layer that sits above Process APIs and tailors responses for specific client applications. For example, a mobile app might need a lightweight response with only essential fields, while a caseworker dashboard might need aggregated data from multiple domains in a single call. The Experience Layer handles this translation so Process APIs remain client-agnostic.

*Rationale*: An Experience Layer adds complexity that isn't justified yet. Process APIs are sufficient for current use cases. Adding this layer now would mean maintaining three API layers before we understand the actual client requirements.

*Reconsider if*: Client applications need significantly different data shapes (e.g., mobile app needs minimal payloads, web dashboard needs aggregated views), or if multiple teams are building frontends with duplicated data-fetching logic.

*Future direction*: When an Experience Layer becomes necessary, GraphQL is likely the best choice. It allows clients to request exactly the fields they need, reducing over-fetching and enabling frontend teams to evolve independently. A GraphQL gateway could sit above Process APIs without changing the underlying architecture.

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

## 9. Migration Considerations

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

## 10. Implementation Phases

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

## 11. Future Considerations

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

## 12. Documentation Gaps

Topics identified but not yet fully documented or implemented.

### Added to api-patterns.yaml (Not Yet Implemented)

The following patterns have been added to [api-patterns.yaml](../../packages/schemas/openapi/patterns/api-patterns.yaml) but require implementation:

| Pattern | Description | Implementation Required |
|---------|-------------|------------------------|
| **Error Handling** | Standard error response structure, error codes, HTTP status guidance | Update `common-responses.yaml` schemas, mock server error responses |
| **API Versioning** | URL-path versioning strategy, deprecation headers | Update OpenAPI specs with version prefix, mock server routing |
| **Idempotency** | `Idempotency-Key` header for safe retries | Mock server must track keys and return stored responses |
| **Batch Operations** | `POST /{resources}/batch` pattern | Add batch endpoints to specs, mock server batch handling |

Each section in `api-patterns.yaml` is marked with `# STATUS: Not yet implemented` to indicate work remaining.

### Needs Architecture Documentation

**Data Retention & Archival**

| Data Type | Active Retention | Archive | Purge |
|-----------|------------------|---------|-------|
| Applications | 7 years after closure | Cold storage | Per state policy |
| Audit logs | 7 years | Immutable archive | Never (compliance) |
| PII | Per program requirements | Encrypted archive | On request + retention period |
| Session/tokens | 24 hours | N/A | Immediate |

*Considerations*:
- Federal programs have specific retention requirements
- Right to deletion must balance against audit requirements
- Archived data must remain queryable for audits

**Event-Driven Architecture / Webhooks**

For external system integration without polling.

| Event | Trigger | Typical Consumers |
|-------|---------|-------------------|
| `application.submitted` | New application received | Document management, eligibility engine |
| `determination.completed` | Eligibility decided | Notice generation, benefits issuance |
| `task.sla_warning` | Task approaching deadline | Supervisor dashboards, alerting |
| `task.assigned` | Task assignment changed | Caseworker notifications |

*Pattern*:
- Events published to message broker (not direct HTTP calls)
- Webhook subscriptions for external consumers
- At-least-once delivery with idempotent consumers
- Event schema versioning aligned with API versioning

**Integration Patterns**

How legacy systems and external services connect.

| Pattern | Use Case | Example |
|---------|----------|---------|
| API Gateway | All external access | Authentication, rate limiting, routing |
| Adapter | Vendor system integration | Workflow vendor → System API translation |
| Anti-corruption layer | Legacy system integration | Mainframe → modern API translation |
| Event bridge | Async integration | Real-time updates to data warehouse |
| Batch file | Legacy batch systems | Nightly SSA data exchange |

### Separate Documents (Future)

**Testing Strategy**

Warrants its own document covering:
- Contract testing (Process APIs against System API contracts)
- Mock server usage patterns
- Integration test data management
- Performance/load testing approach

**Security & RBAC**

Detailed security design including:
- Role definitions and permissions matrix
- Authentication flows (OAuth/OIDC)
- Field-level authorization rules
- Audit logging requirements

---

## 13. References

### Related Documentation

| Document | Purpose |
|----------|---------|
| [api-patterns.yaml](../../packages/schemas/openapi/patterns/api-patterns.yaml) | Machine-readable API design patterns and conventions |
| [Creating APIs Guide](../guides/creating-apis.md) | How to create new API specifications |
| [Mock Server Guide](../guides/mock-server.md) | Using the mock server for development |
| [Search Patterns Guide](../guides/search-patterns.md) | Query syntax documentation |
| [State Overlays Guide](../guides/state-overlays.md) | Customizing specs for state-specific needs |

### Architecture Decision Records

| ADR | Decision |
|-----|----------|
| [Search Patterns](../architecture-decisions/search-patterns.md) | Query parameter syntax |
| [Multi-State Overlays](../architecture-decisions/multi-state-overlays.md) | State customization approach |
| [OpenAPI TS Client Generation](../architecture-decisions/openapi-ts-client-generation.md) | TypeScript client generation |
| [Workspace Restructure](../architecture-decisions/workspace-restructure.md) | Monorepo organization |

### Schema Files

- `packages/schemas/openapi/applications.yaml` - Current Application API
- `packages/schemas/openapi/components/application.yaml` - Current Application schema
- `packages/schemas/openapi/components/person.yaml` - Current Person schema
- `packages/schemas/openapi/components/common.yaml` - Shared schemas
