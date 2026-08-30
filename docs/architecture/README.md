# Architecture Documentation

This directory contains architecture documentation for the Safety Net Benefits API.

> **Status: Work in progress** — The system is being designed incrementally, domain by domain.

## Guiding principles

1. **Match industry and domain patterns.** Evaluate design decisions against what major vendors (JSM, ServiceNow, IBM Curam, Salesforce Government Cloud) and states are doing in the safety net benefits space. Prefer established patterns and document vendor comparisons in domain-level design references.
2. **Prioritize flexibility and extensibility.** Baseline contracts are a starting point for states to customize, not a fixed prescription. Prefer overlay points, configurable values, and compositional patterns over hardcoded behavior. When a design decision constrains extensibility, document it explicitly.

## How this documentation is organized

| Document | What it covers |
|----------|---------------|
| [Domain Design](domain-design.md) | Domain organization, entities, data flow, and domain status |
| [Contract-Driven Architecture](contract-driven-architecture.md) | Contract artifacts for backend and frontend portability. Frontend harness packages are in a [separate repo](https://github.com/codeforamerica/safety-net-harness). |
| [API Architecture](api-architecture.md) | API organization, operational concerns, quality attributes |
| [Design Rationale](design-rationale.md) | Key decisions with rationale and alternatives |
| [Resolve Pipeline](resolve-pipeline.md) | How base specs and overlays are merged into deployment artifacts |
| [Roadmap](roadmap.md) | Implementation phases, prototypes, future considerations |

## Domain and cross-cutting docs

| Document | Description |
|----------|-------------|
| [Case Management](domains/case-management.md) | Ongoing client relationships, staff, and organizational structure |
| [Workflow](domains/workflow.md) | Task lifecycle, contract artifacts (state machine, rules, metrics) |
| [Identity & Access](cross-cutting/identity-access.md) | Authentication, authorization, JWT claims, and User Service |
| [Communication](cross-cutting/communication.md) | Notices and correspondence |

See [Domain Design](domain-design.md) for the full list of domains, cross-cutting concerns, and their current design status.

## Other resources

| Resource | Description |
|----------|-------------|
| [conventions/](../conventions/) | Machine-readable API design patterns |
| [Decisions](../decisions/) | Architectural decisions (auth, search, state customization, tooling) |
| [Prototypes](../prototypes/) | Implementation specs for proving architecture patterns |
| [Guides](../guides/) | How-to guides for working with the toolkit |
