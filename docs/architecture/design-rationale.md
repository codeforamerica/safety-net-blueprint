# Design Rationale

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

*Rationale*: They answer different questions. Workflow = "What needs to be done?" Case Management = "Who's responsible for getting this done?"

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

### How to handle verification failures?

| Option | Considered | Chosen |
|--------|------------|--------|
| Immediate denial | Fail verification → deny application | No |
| Manual escalation | Worker decides next steps | No |
| Rule-driven outcomes | Workflow rules determine next task based on failure reason | Yes |

*Rationale*: Verification failure isn't necessarily application denial—it often means "need more information." The Task entity captures the outcome (`failed`, `passed`, `inconclusive`) and reason. Workflow rules evaluate the outcome and create appropriate follow-up tasks:

- `documents_insufficient` → Create "Request additional documentation" task, set case to `pending_information`
- `unable_to_verify` → Escalate to supervisor queue
- `fraud_suspected` → Route to fraud investigation workflow

This keeps verification logic declarative (in workflow rules) rather than hardcoded.

*Example workflow rule*:
```json
{
  "condition": {
    "and": [
      { "==": [{ "var": "task.type" }, "verify_income"] },
      { "==": [{ "var": "task.outcome" }, "failed"] },
      { "==": [{ "var": "task.outcomeReason" }, "documents_insufficient"] }
    ]
  },
  "actions": [
    { "createTask": { "type": "request_documents", "assignTo": "client" } },
    { "updateCase": { "status": "pending_information" } }
  ]
}
```

*Reconsider if*: Failure handling becomes complex enough to warrant a dedicated state machine or if business users need a visual workflow editor for defining failure paths.

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

> **Superseded** by [Contract-Driven Architecture](contract-driven-architecture.md). The state machine YAML IS the workflow definition — declarative, table-authored, and interpreted by the mock server and production adapters. This replaces the choice between explicit tasks and a workflow engine with a contract-driven approach that provides both: declarative definitions authored in tables, with the adapter (or vendor engine) interpreting them at runtime.

| Option | Considered | Chosen |
|--------|------------|--------|
| Explicit Task entities | Simple, flexible, follows existing patterns | ~~Yes~~ |
| BPMN workflow engine | Declarative, visual modeling | No |
| Contract-driven state machine | Declarative YAML, table-authored, interpreted by adapter | **Yes** |

*Original rationale*: Explicit tasks are simpler and sufficient for v1. A workflow engine can be layered on top later if needed.

---

### JSON Logic for Workflow Rule Conditions

| Option | Considered | Chosen |
|--------|------------|--------|
| Hardcoded condition fields | Simple but requires schema changes for new conditions | No |
| Custom expression language | Maximum flexibility but proprietary | No |
| JSON Logic | Standard, portable, well-documented | Yes |
| MongoDB-style queries | Familiar syntax, but less expressive | No |
| OPA/Rego | Powerful but heavy, separate runtime | No |

*Rationale*: [JSON Logic](https://jsonlogic.com/) is an open standard for expressing conditions as JSON objects. It has implementations in JavaScript, Python, Java, Go, and other languages. Workflow rules can define arbitrary conditions without schema changes—new condition types are added by exposing new context variables, not by changing the schema.

*Example*:
```json
{
  "and": [
    { "==": [{ "var": "task.programType" }, "snap"] },
    { "<": [{ "var": "application.household.youngestChildAge" }, 6] }
  ]
}
```

*Reconsider if*: Conditions become complex enough to require a full rules engine (e.g., Drools), or if business users need a visual rule builder (which would generate JSON Logic underneath).

---

### Configurable vs Hardcoded Task and SLA Types

| Option | Considered | Chosen |
|--------|------------|--------|
| Hardcoded enums | Simple but inflexible; schema changes for new types | No |
| Configuration entities | TaskType and SLAType as lookup tables with `code` as PK | Yes |
| UUIDs for configuration | Standard approach but less user-friendly | No |

*Rationale*: Task types and SLA types are configuration data that changes as programs evolve. Using `code` as the primary key (e.g., `verify_income`, `snap_expedited`) is more readable and user-friendly than UUIDs. New task types can be added without schema changes.

*Reconsider if*: Configuration data needs to be synchronized across systems where code collisions are possible (UUIDs would guarantee uniqueness).

---

### System APIs vs Process APIs?

> **Superseded** by [Contract-Driven Architecture](contract-driven-architecture.md). The two-layer System/Process API model is replaced by REST APIs (data-shaped) and RPC APIs (behavior-shaped) within the same domain. RPC endpoints are generated from state machine triggers, not hand-written as a separate API layer.

| Option | Considered | Chosen |
|--------|------------|--------|
| Single API layer | Simpler, fewer moving parts | No |
| Two layers (System + Process) | Clear separation of data access vs orchestration | ~~Yes~~ |
| REST + RPC within same domain | API type determined by contract artifacts | **Yes** |

*Original rationale*: System APIs provide RESTful CRUD access to domain data. Process APIs orchestrate business operations by calling System APIs. This separation means Process APIs contain business logic while System APIs remain simple and reusable.

---

### What should the mock server cover?

> **Superseded** by [Contract-Driven Architecture](contract-driven-architecture.md). The mock server interprets all contract artifacts — OpenAPI specs, state machine YAML, rules, metrics, and form definitions. It serves as the development adapter, generating both REST and RPC endpoints from contracts.

| Option | Considered | Chosen |
|--------|------------|--------|
| All APIs | Complete testing environment | **Yes** |
| System APIs only | Mock data layer, test real orchestration | ~~Yes~~ |

*Original rationale*: Process APIs are orchestration logic—that's what you want to test. Mocking them defeats the purpose. Real Process API implementations call mock System APIs during development.

---

### How to organize Process APIs?

> **Superseded** by [Contract-Driven Architecture](contract-driven-architecture.md). RPC endpoints are generated from state machine triggers, not organized manually. Each trigger on a resource becomes `POST /{domain}/{resource}/{id}/{trigger}` — e.g., `claim` on `Task` in `workflow` becomes `POST /workflow/tasks/:id/claim`.

| Option | Considered | Chosen |
|--------|------------|--------|
| By actor (client/, caseworker/, admin/) | Intuitive grouping by who uses it | No |
| By capability (applications/, eligibility/, tasks/) | Actor-agnostic, same operation available to multiple actors | No |
| By domain, then resource, then action | Clear hierarchy, matches domain structure | ~~Yes~~ |
| Generated from state machine triggers | Endpoints derived from contracts | **Yes** |

*Original rationale*: Many operations are used by multiple actors (e.g., both clients and caseworkers can submit applications). Actor metadata (`x-actors: [client, caseworker]`) handles authorization without duplicating endpoints. Organizing by domain provides clear ownership and aligns with the System API structure.

---

### What is the purpose of reference implementations?

> **Superseded** by [Contract-Driven Architecture](contract-driven-architecture.md). States build adapters that satisfy the behavioral contracts, not reference implementations of a separate Process API layer. The mock server serves as the reference adapter — it interprets contract artifacts directly. States build production adapters that expose the same API surface, translating to their vendor systems.

| Option | Considered | Chosen |
|--------|------------|--------|
| Production-ready code to extend | States fork and customize | No |
| Educational examples | States learn patterns, implement from scratch | ~~Yes~~ |
| Mock server as reference adapter | States build adapters satisfying contracts | **Yes** |

*Original rationale*: Reference implementations demonstrate how to implement Process APIs against System API contracts. States implement in their preferred language/framework. Extending reference code creates maintenance burden and hidden coupling.

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
| Adapter serves all clients | Clients call the adapter directly | Yes |
| GraphQL in the future | Flexible querying when client needs diverge | Deferred |

*What is an Experience Layer?* An Experience Layer (sometimes called "Backend for Frontend" or BFF) is an API layer that sits above the adapter and tailors responses for specific client applications. For example, a mobile app might need a lightweight response with only essential fields, while a caseworker dashboard might need aggregated data from multiple domains in a single call.

*Rationale*: An Experience Layer adds complexity that isn't justified yet. The adapter's REST and RPC APIs are sufficient for current use cases.

*Reconsider if*: Client applications need significantly different data shapes (e.g., mobile app needs minimal payloads, web dashboard needs aggregated views), or if multiple teams are building frontends with duplicated data-fetching logic.

*Future direction*: When an Experience Layer becomes necessary, GraphQL is likely the best choice. It allows clients to request exactly the fields they need, reducing over-fetching and enabling frontend teams to evolve independently. A GraphQL gateway could sit above the adapter without changing the underlying architecture.

---

### How to organize API specs by domain and type?

> **Superseded** by [Contract-Driven Architecture](contract-driven-architecture.md). The `x-api-type` extension (with values `system`, `process`, `cross-cutting`) has been removed. The contract-driven architecture expresses API type through which contract artifacts exist — OpenAPI spec only = data-shaped (REST), OpenAPI spec + state machine = behavior-shaped (REST + RPC) — not through a metadata tag. No code reads `x-api-type`. The `x-domain` and `x-status` extensions remain.

| Option | Considered | Chosen |
|--------|------------|--------|
| Folder-based organization | Nested folders (`system/intake/`, `cross-cutting/`) | No |
| OpenAPI x-extensions | Metadata tags (`x-domain`, `x-api-type`, `x-status`) | ~~Yes~~ |
| x-extensions without x-api-type | `x-domain`, `x-status`, `x-visibility` — API type from contract artifacts | **Yes** |

*Original rationale*: Folder-based organization requires updating tooling (loaders, validation scripts, Spectral globs) whenever the structure changes. Using x-extensions provides the same logical organization without breaking existing tooling.

*Extensions defined*:
- `x-domain`: Business domain (intake, client-management, workflow, eligibility, etc.)
- `x-status`: Implementation status (planned, alpha, beta, stable, deprecated)
- `x-visibility`: Access scope (public, partner, internal)

*Example*:
```yaml
info:
  title: Applications API
  x-domain: intake
  x-status: stable
  x-visibility: public
```

See [api-patterns.yaml](../../packages/contracts/patterns/api-patterns.yaml) for full documentation.

*Reconsider if*: The flat file structure becomes unwieldy with many APIs, or if physical separation is needed for access control or separate deployment.

