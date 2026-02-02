# Architecture Documentation

This directory contains architecture documentation for the Safety Net Benefits API.

> **Status: In Progress**
> Architecture documentation is being added incrementally. Currently documented:
> - Identity & Access (cross-cutting)
>
> Future additions will include domain designs (Intake, Case Management, Eligibility, Workflow, etc.) and additional cross-cutting concerns.

## Documents

| Document | Description |
|----------|-------------|
| [Cross-Cutting: Identity & Access](cross-cutting/identity-access.md) | Authentication, authorization, JWT claims, and User Service |

## Cross-Cutting Concerns

Cross-cutting concerns span multiple domains:

| Concern | Status | Description |
|---------|--------|-------------|
| **Identity & Access** | Documented | Authentication via IdP, authorization via User Service |
| Communication | Planned | Notices and correspondence |
| Reporting | Planned | Aggregated data and audit events |
| Configuration | Planned | Business-configurable rules |
| Observability | Planned | Health checks, metrics, logging |

## Related Resources

| Resource | Description |
|----------|-------------|
| [api-patterns.yaml](../../packages/schemas/openapi/patterns/api-patterns.yaml) | Machine-readable API design patterns |
| [Architecture Decision Records](../architecture-decisions/) | Formal ADRs for significant decisions |
| [Guides](../guides/) | How-to guides for working with the toolkit |
