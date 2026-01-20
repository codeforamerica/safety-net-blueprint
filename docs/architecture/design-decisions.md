# Design Decisions

Key decisions made during design, with alternatives considered. These are **proposed decisions** - review and adjust before implementation.

See also: [Domain Design](domain-design.md) | [API Architecture](api-architecture.md) | [Roadmap](roadmap.md)

> **How to use this log**: Each decision includes the options we considered and why we chose one over others. If circumstances change or new information emerges, revisit the rationale to determine if a different choice makes more sense.

---

## Decision Log

### Where does Application live?

| Option | Considered | Chosen |
|--------|------------|--------|
| Intake | Application captures what the client reports | Yes |
| Eligibility | Application is fundamentally about determining eligibility | No |
| Case Management | Application is one event in a larger case lifecycle | No |

*Rationale*: Application is the client's perspective - what they told us. Eligibility interprets that data per program rules. Case Management tracks the ongoing relationship across multiple applications.

*Reconsider if*: Applications become tightly coupled to eligibility rules rather than being a neutral record of client-reported data.

---

### How to handle living arrangements and eligibility groupings?

| Option | Considered | Chosen |
|--------|------------|--------|
| Single "Household" entity | Simple, but conflates factual and regulatory concepts | No |
| Snapshots only | Each application captures composition at that moment | Partially |
| Split: LivingArrangement + EligibilityUnit | Factual data persists; programs interpret into eligibility units | Yes |

*Rationale*: "Household" is a regulatory term with different meanings per program (IRS, SNAP, Medicaid). We use `LivingArrangement` for the factual "who do you live with" data (in Client Management and Intake), and `EligibilityUnit` for program-specific groupings (in Eligibility). Regulatory terms like "household" or "tax unit" appear in descriptions.

*Reconsider if*: Living arrangement changes are infrequent and the complexity of tracking both isn't justified, or if all programs use the same grouping rules.

---

### Is Income its own domain?

| Option | Considered | Chosen |
|--------|------------|--------|
| Own domain | Complex enough to warrant separation | No |
| Part of Eligibility | Only useful for eligibility | No |
| Split: Income (Intake) + verified income (Eligibility) | Matches reported vs interpreted pattern | Yes |

*Rationale*: Follows the same pattern as household - what client reports vs how programs interpret it.

*Reconsider if*: Income tracking becomes significantly more complex (e.g., real-time income verification, multiple income sources with independent lifecycles) and warrants dedicated APIs.

---

### Case Management vs Workflow: one or two domains?

| Option | Considered | Chosen |
|--------|------------|--------|
| Combined | Simpler, fewer domains | No |
| Separate | Clear separation of concerns | Yes |

*Rationale*: They answer different questions. Workflow = "What needs to be done?" Case Management = "Who's responsible for this relationship?"

*Reconsider if*: The separation creates too much complexity in practice, or if case workers primarily interact with the system through tasks (making them effectively the same).

---

### Where does Verification live?

| Option | Considered | Chosen |
|--------|------------|--------|
| Own domain | Verification is complex | No |
| Part of Workflow | Verification is work that needs to be done | Yes |
| Part of Case Management | Case workers do verification | No |

*Rationale*: Verification tasks are work items with SLAs and outcomes - fits naturally with Workflow.

*Reconsider if*: Verification becomes a complex subsystem with its own rules engine, third-party integrations, and document processing pipelines.

---

### Is Reporting its own domain?

| Option | Considered | Chosen |
|--------|------------|--------|
| Own domain | Could hold report definitions, metrics | No |
| Cross-cutting concern | Aggregates data from all domains | Yes |

*Rationale*: Reporting doesn't own entities - it consumes data from other domains. Audit events live where actions happen.

*Reconsider if*: Federal reporting requirements become complex enough to warrant standardized report definitions, scheduling, and delivery tracking as first-class entities.

---

### Terminology: what to call people receiving benefits?

| Option | Considered | Chosen |
|--------|------------|--------|
| Person | Generic | No |
| Client | Common in social work | Yes |
| Participant | Common in federal programs | No |
| Beneficiary | Implies already receiving benefits | No |

*Rationale*: "Client" is widely used in social services and clearly indicates someone the agency serves.

*Reconsider if*: Integrating with systems that use different terminology (e.g., "participant" in federal systems) and alignment is important.

---

### What financial data belongs in Client Management vs Intake?

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

### Should entities have distinct names across domains?

| Option | Considered | Chosen |
|--------|------------|--------|
| Distinct names per domain | Self-documenting, explicit | No |
| Same name, domain provides context | Simpler, less cognitive load | Yes |

*Rationale*: If entities are organized under domains with distinct API paths, the domain context already provides disambiguation. Using the same name (`Income`) in both Client Management and Intake is simpler and more natural. The path tells you the difference: `/clients/{id}/income` vs `/applications/{id}/income`.

*Reconsider if*: Developers frequently work across domains and find the shared naming confusing, or if schemas need to be referenced in a shared context where domain isn't clear.

---

### Explicit Tasks vs Workflow Engine?

| Option | Considered | Chosen |
|--------|------------|--------|
| Explicit Task entities | Simple, flexible, follows existing patterns | Yes |
| BPMN workflow engine | Declarative, visual modeling | No |

*Rationale*: Explicit tasks are simpler and sufficient for v1. A workflow engine can be layered on top later if needed.

*Reconsider if*: Workflows become complex enough that declarative definitions and visual modeling would significantly reduce implementation effort, or if non-developers need to modify workflows.

---

### System APIs vs Process APIs?

| Option | Considered | Chosen |
|--------|------------|--------|
| Single API layer | Simpler, fewer moving parts | No |
| Two layers (System + Process) | Clear separation of data access vs orchestration | Yes |

*Rationale*: System APIs provide RESTful CRUD access to domain data. Process APIs orchestrate business operations by calling System APIs. This separation means Process APIs contain business logic while System APIs remain simple and reusable.

*Reconsider if*: The overhead of maintaining two layers isn't justified by the complexity of the business processes, or if most operations map 1:1 to CRUD actions.

---

### What should the mock server cover?

| Option | Considered | Chosen |
|--------|------------|--------|
| All APIs | Complete testing environment | No |
| System APIs only | Mock data layer, test real orchestration | Yes |

*Rationale*: Process APIs are orchestration logic—that's what you want to test. Mocking them defeats the purpose. Real Process API implementations call mock System APIs during development.

*Reconsider if*: Teams need to develop against Process APIs before implementations exist, or if Process API behavior is complex enough to warrant contract testing via mocks.

---

### How to organize Process APIs?

| Option | Considered | Chosen |
|--------|------------|--------|
| By actor (client/, caseworker/, admin/) | Intuitive grouping by who uses it | No |
| By capability (applications/, eligibility/, tasks/) | Actor-agnostic, same operation available to multiple actors | Partially |
| By domain, then resource, then action | Clear hierarchy, matches domain structure | Yes |

*Rationale*: Many operations are used by multiple actors (e.g., both clients and caseworkers can submit applications). Actor metadata (`x-actors: [client, caseworker]`) handles authorization without duplicating endpoints. Organizing by domain provides clear ownership and aligns with the System API structure.

*Path pattern*: `/processes/{domain}/{resource}/{action}`

*Examples*:
- `/processes/workflow/tasks/claim`
- `/processes/case-management/workers/assign`
- `/processes/communication/notices/send`

*Convention*: When an operation involves multiple resources, place it under the resource being acted upon (not the primary output). This matches natural language and improves discoverability.

See [api-patterns.yaml](../../packages/schemas/openapi/patterns/api-patterns.yaml) for the `x-actors` and `x-capability` extension definitions.

*Reconsider if*: Actor-specific behavior diverges significantly (different request/response shapes), making shared endpoints awkward.

---

### What is the purpose of reference implementations?

| Option | Considered | Chosen |
|--------|------------|--------|
| Production-ready code to extend | States fork and customize | No |
| Educational examples | States learn patterns, implement from scratch | Yes |

*Rationale*: Reference implementations demonstrate how to implement Process APIs against System API contracts. States implement in their preferred language/framework. Extending reference code creates maintenance burden and hidden coupling.

*Reconsider if*: Implementation patterns are complex enough that reference code provides significant value, or if a common framework emerges across states.

---

### How to achieve vendor independence?

| Option | Considered | Chosen |
|--------|------------|--------|
| Standardize on specific vendors | Simpler, less abstraction | No |
| Adapter pattern | Thin translation layer between contracts and vendors | Yes |

*Rationale*: Process APIs call System API contracts, not vendor APIs directly. Adapters translate between canonical models and vendor-specific implementations. Switching vendors means rewriting adapters, not business logic.

*Reconsider if*: Vendor capabilities diverge so significantly that adapters become complex business logic themselves.

---

### What's configurable vs code?

| Option | Considered | Chosen |
|--------|------------|--------|
| Everything in code | Simpler deployment, version controlled | No |
| Split by who changes it | Policy analyst changes = config; developer changes = code | Yes |

*Rationale*: Workflow rules, eligibility thresholds, SLA timelines, and notice templates change frequently and shouldn't require deployments. Business users can adjust these through Admin APIs. Configuration is versioned and audited.

*Reconsider if*: Configuration complexity grows to the point where it's effectively code, or if audit/versioning requirements are better served by version control.

---

### Should there be an Experience Layer?

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

## Summary Tables

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
