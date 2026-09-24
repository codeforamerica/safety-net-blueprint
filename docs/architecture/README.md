# Architecture Documentation

The Safety Net Blueprint is a contract-driven framework for building portable, vendor-independent benefits systems. Rather than prescribing a specific technology stack, it defines the *interfaces* — API contracts, state machines, rules, event schemas, and field metadata — that any compliant implementation must satisfy. States adopt the baseline contracts, customize via overlay, and build adapters to connect their vendor systems.

This directory documents the architectural decisions behind those contracts: why they're structured the way they are, what trade-offs were made, and how states can extend them.

For the design philosophies that shape every decision here, start with [Architecture Philosophy](architecture-philosophy.md).

## Core architecture docs

| Document | What it covers |
|----------|---------------|
| [Contract-Driven Architecture](contract-driven-architecture.md) | The foundational model: how contracts enable vendor portability at both the API and behavior layers |
| [API Architecture](api-architecture.md) | API organization, REST vs. RPC, operational concerns, and quality attributes |
| [Resolve Pipeline](resolve-pipeline.md) | How base specs and state overlays are merged into deployment-ready artifacts |
| [Rules Contracts](rules-contracts.md) | Dependency graph rules: partial evaluation, what it enables, invocation modes, and design decisions |
| [Architecture Patterns](architecture-patterns.md) | The specific software patterns used to realize the design philosophies |
| [Inter-Domain Communication](inter-domain-communication.md) | How domains communicate without direct coupling |
| [X-Extensions](x-extensions.md) | Blueprint-specific OpenAPI extensions (`x-domain`, `x-relationship`, etc.) |
| [Contracts Pipeline](contracts-pipeline.md) | The full contracts build pipeline: validation, lint, resolve, and artifact generation |

## Domain docs

One document per domain — entity model, lifecycle, events, and key design decisions.

| Document | Domain |
|----------|--------|
| [Domain Design](domains/domain-design.md) | Domain organization, boundaries, and current design status across all domains |
| [Intake](domains/intake.md) | Application submission, processing clocks, interview requirements |
| [Eligibility](domains/eligibility.md) | Determination lifecycle, program rules, and categorical eligibility |
| [Case Management](domains/case-management.md) | Ongoing client relationships, staff, and organizational structure |
| [Workflow](domains/workflow.md) | Task lifecycle, assignment, SLA enforcement, and audit |
| [Client Management](domains/client-management.md) | Client identity, household composition, and cross-program records |
| [Document Management](domains/document-management.md) | Document upload, classification, verification status, and retention |
| [Data Exchange](domains/data-exchange.md) | External data requests: income verification, citizenship, state data matches |
| [Scheduling](domains/scheduling.md) | Appointment scheduling across channels |
| [Communication](domains/communication.md) | Notices, correspondence, and multi-channel delivery |

## Cross-cutting docs

Concerns that span multiple domains.

| Document | What it covers |
|----------|---------------|
| [Identity & Access](cross-cutting/identity-access.md) | Authentication, authorization, JWT claims, and the User Service |
| [Contract Metadata](cross-cutting/contract-metadata.md) | Annotations, field-level metadata, and policy traceability |
| [Resource Composition](cross-cutting/resource-composition.md) | Composite resources that aggregate data from multiple APIs within a domain |
| [Adapters](cross-cutting/adapters.md) | The adapter pattern: how vendor systems connect without coupling |
| [Behavioral Contract DSL](cross-cutting/behavioral-contract-dsl.md) | State machine YAML format and expression language |
| [Search](cross-cutting/search.md) | Cross-domain search patterns |
| [Scheduling Service](cross-cutting/scheduling-service.md) | The shared scheduling infrastructure |

## Other resources

| Resource | Description |
|----------|-------------|
| [API conventions](../conventions/) | Machine-readable API design conventions (naming, resources, RPC, security, etc.) |
| [Guides](../guides/) | How-to guides: creating APIs, overlays, mock server, testing |
| [Getting started](../getting-started/) | Role-based onboarding guides |
