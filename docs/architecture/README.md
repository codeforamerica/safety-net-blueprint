# Architecture Documentation

This directory contains architecture documentation for the Safety Net Benefits API.

> **Status: Work in progress** — The system is being designed incrementally, domain by domain.

## How this documentation is organized

| Document | What it covers |
|----------|---------------|
| [Domain Design](domain-design.md) | Domain organization, entities, data flow, and domain status |
| [Contract-Driven Architecture](contract-driven-architecture.md) | Contract artifacts for backend and frontend portability |
| [API Architecture](api-architecture.md) | API organization, operational concerns, quality attributes |
| [Design Rationale](design-rationale.md) | Key decisions with rationale and alternatives |
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
| [api-patterns.yaml](../../packages/schemas/openapi/patterns/api-patterns.yaml) | Machine-readable API design patterns |
| [Decisions](../decisions/) | Architectural decisions (auth, search, state customization, tooling) |
| [Prototypes](../prototypes/) | Implementation specs for proving architecture patterns |
| [Guides](../guides/) | How-to guides for working with the toolkit |
