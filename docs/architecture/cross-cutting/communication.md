# Communication (Cross-Cutting)

> **Status: Work in progress** — High-level design. Detailed contract artifacts TBD.

See [Domain Design Overview](../domain-design.md) for context and [Contract-Driven Architecture](../contract-driven-architecture.md) for the contract approach.

## Overview

Communication is cross-cutting because notices and correspondence can originate from any domain:
- **Intake**: "Application received"
- **Eligibility**: "Approved", "Denied", "Request for information"
- **Workflow**: "Documents needed", "Interview scheduled"
- **Case Management**: "Case worker assigned"

## Entities

| Entity | Purpose |
|--------|---------|
| **Notice** | Official communication (approval, denial, RFI, etc.) |
| **Correspondence** | Other communications (client inquiries, worker notes, inter-agency) |
| **DeliveryRecord** | Tracking of delivery status across channels |

Detailed schemas will be defined in the OpenAPI spec as the domain is developed.

## Contract Artifacts

Following the [contract-driven architecture](../contract-driven-architecture.md#contract-artifacts), Communication is a **behavior-shaped** domain — notices have a lifecycle (draft, review, approved, sent, delivered/failed) with guards, effects, and side effects. Expected contract artifacts:

| Artifact | Status | Notes |
|----------|--------|-------|
| OpenAPI spec | TBD | REST APIs for notices, correspondence, and delivery records |
| State machine YAML | TBD | Notice lifecycle — states, transitions, guards (e.g., supervisor approval), effects (e.g., initiate delivery, create audit event) |
| Rules YAML | TBD | Routing rules (e.g., which notices require supervisor review, retry policies) |
| Metrics YAML | TBD | Delivery success rates, time-to-send, failed delivery tracking |

## Key Design Questions

- **Notice lifecycle** — What states and transitions does a notice go through? Which transitions require supervisor approval?
- **Delivery channels** — How are multiple delivery methods (postal, email, portal) modeled? Per-notice or per-delivery-record?
- **Template system** — How do notice templates connect to the form definition or configuration artifacts?
- **Event triggers** — How do other domains trigger notices? Direct RPC calls, or event-driven (e.g., an eligibility determination transition fires a `notify` effect)?
- **Retry behavior** — How are failed deliveries retried? Automatic via state machine timeout, or manual via RPC operation?

## Related Documents

| Document | Description |
|----------|-------------|
| [Domain Design](../domain-design.md) | Communication section in the domain overview |
| [Contract-Driven Architecture](../contract-driven-architecture.md) | Contract artifacts and the adapter pattern |
