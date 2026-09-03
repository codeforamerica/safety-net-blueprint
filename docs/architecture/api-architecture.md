# API Architecture

> **Status: Work in progress** — Some operational, performance, and reliability patterns referenced here are not yet fully documented.

How the Safety Net Benefits API is organized and operated.

See also: [Contract-Driven Architecture](contract-driven-architecture.md) | [Domain Design](domain-design.md) | [Design Rationale](design-rationale.md) | [Roadmap](roadmap.md)

---

## API Organization

APIs are organized by [domain](domain-design.md), with two API types:

- **REST** — CRUD operations on resources (`GET /workflow/tasks`, `POST /workflow/tasks`, `GET /workflow/tasks/:id`)
- **RPC** — Behavioral operations generated from state machine triggers (`POST /workflow/tasks/:id/claim`, `POST /workflow/tasks/:id/complete`)

Which API types a domain exposes depends on its contract artifacts. Data-shaped domains expose only REST APIs. Behavior-shaped domains expose both REST and RPC APIs. See [Contract-Driven Architecture](contract-driven-architecture.md) for how contract artifacts define the API surface.

Standard API patterns — error handling, pagination, versioning, authentication, idempotency, ETags, rate limiting, and standard endpoints (health, readiness, metrics) — are defined in the [API conventions](../conventions/).

---

## Vendor Independence

Contract artifacts define what the system must do. States build adapters that translate between the contracts and their vendor systems. Switching vendors means rewriting the adapter, not the business logic or frontend. See [Contract-Driven Architecture](contract-driven-architecture.md) for the adapter pattern and guidance for states.

---

## Operational Concerns

Each domain has different operational and performance requirements. Caching policies, query complexity limits, and domain-specific metrics are documented in the domain's own architecture doc (e.g., [Workflow metrics](domains/workflow.md#metrics)). This section covers cross-cutting operational concerns that apply across all domains.

### Observability

| Capability | Purpose | Details |
|------------|---------|---------|
| Health & readiness | Is the system up and ready? | Standard endpoints in [API conventions](../conventions/http.yaml) |
| Metrics | Request rates, latencies, error rates | Prometheus format |
| Structured logging | Searchable, consistent format | JSON with correlation IDs, PII masked |
| Distributed tracing | Follow requests across APIs | OpenTelemetry |
| Audit logs | Who did what when | Cross-cutting audit domain, built from every domain's own immutable mutation events — see [Domain Design](domain-design.md#1-domain-organization) |

**API-level SLI metrics:**

| Metric | Description | Target |
|--------|-------------|--------|
| `api_latency_seconds` | Response time (p50, p95, p99) | p95 < 500ms |
| `error_rate` | Error rate by endpoint (4xx, 5xx) | < 1% |
| `availability` | Service uptime | 99.9% |

### Configuration Management

**Principle:** If a policy analyst needs to change it, it's configuration. If a developer needs to change it, it's code.

Business-configurable settings — workflow rules, eligibility thresholds, SLA timelines, notice templates, feature flags, business calendars — must be changeable without code deployments. Configuration changes must be audited, versioned, and validated.

How configuration is exposed (dedicated admin APIs, per-domain config endpoints, or an external config store) is a design decision that has not yet been made.

### Security

**Data classification** — All API fields are classified for appropriate handling:

| Classification | Description | Example Fields |
|----------------|-------------|----------------|
| `pii` | Personally Identifiable Information | SSN, DOB, name, address |
| `sensitive` | Sensitive but not PII | income, case notes, medical info |
| `internal` | Internal operational data | assignedToId, queueId, timestamps |
| `public` | Non-sensitive reference data | programType, taskTypeCode, status |

PII is encrypted at rest, masked in logs, and access is audited. Authentication, authorization, and security headers are defined in the [API conventions](../conventions/security.yaml).

### Compliance

| Concern | Notes |
|---------|-------|
| Data retention | Retention periods are program-specific. See [Roadmap](roadmap.md). |
| Right to deletion | Must balance client rights against audit requirements. Application data may be anonymized rather than deleted. |
| Regulatory references | SNAP (7 CFR 272.1), Medicaid (42 CFR 431.17), TANF (45 CFR 265.2), HIPAA (Medicaid health info), FERPA (education data) |

Detailed compliance mapping is state-specific. States should map these requirements to their field-level handling.

### Reliability

Idempotency, circuit breakers, error handling, and long-running operation patterns are defined in the [API conventions](../conventions/http.yaml). Circuit breaker locations include external verification sources, vendor system adapters, and notice delivery services.

---

## Quality Attributes Index

| Quality Attribute | Location |
|-------------------|----------|
| **Reliability** | |
| Idempotency, circuit breakers, error handling | [API conventions](../conventions/http.yaml) |
| Long-running operations | [API conventions](../conventions/http.yaml) |
| **Security** | |
| Authentication, authorization, security headers | [API conventions](../conventions/security.yaml) |
| Data classification, audit logging | [api-architecture.md](#security) (this file) |
| **Performance** | |
| Pagination, rate limiting | [API conventions](../conventions/resources.yaml) |
| Domain-specific caching and query limits | Individual domain docs |
| **Observability** | |
| Health endpoints, correlation IDs | [API conventions](../conventions/http.yaml) |
| API-level metrics, logging, tracing | [api-architecture.md](#observability) (this file) |
| Domain-specific metrics | Individual domain docs (e.g., [Workflow](domains/workflow.md#metrics)) |
| **Compliance** | |
| Data retention, deletion, regulatory refs | [api-architecture.md](#compliance) (this file) |
| **Interoperability** | |
| API versioning, ETags/concurrency | [API conventions](../conventions/http.yaml) |
| Vendor independence | [Contract-Driven Architecture](contract-driven-architecture.md) |
| **Maintainability** | |
| Configuration management | [api-architecture.md](#configuration-management) (this file) |
| Schema patterns | [API conventions](../conventions/resources.yaml) |
| OpenAPI extensions (x- extensions) | [x-extensions.md](x-extensions.md) |
