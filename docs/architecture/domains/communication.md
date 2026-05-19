# Communication Domain

> **Status:** Minimal contracts implemented for document request notices. Full notice lifecycle TBD.

See [Domain Design Overview](../domain-design.md) for context and [Contract-Driven Architecture](../contract-driven-architecture.md) for the contract approach.

## Overview

The Communication domain sends and tracks notices to clients — approvals, denials, requests for information, document requests, and other official correspondence. Notices can originate from any domain; Communication reacts to domain events and handles delivery.

**Entities owned by this domain:**

- **Notice** — an official communication sent to a client (full schema TBD)

## Event-Driven Trigger Model

Communication sends notices by subscribing to domain events rather than receiving direct API calls. The producing domain emits an event when its own state changes; Communication reacts independently. No calling domain has a compile-time or runtime dependency on the Communication API contract.

This is consistent with the decision rule in [`docs/architecture/inter-domain-communication.md`](../inter-domain-communication.md): use a command only when the caller needs a result to continue its operation. Sending a notice is a fire-and-observe side effect, not a blocking dependency.

### Inbound: `intake.verification.created` (document-type)

Communication subscribes to this event filtered by `verificationType === 'document'`. When a document-type Verification is created — either at application submission (e.g., residency) or as a fallback after an inconclusive electronic check — Communication sends a document request notice to the applicant.

### Outbound: `communication.notice.sent`

Emitted after a notice is sent.

| Field | Type | Notes |
|-------|------|-------|
| `noticeId` | uuid | The notice record ID |
| `type` | enum | Template identifier — see `NoticeSentEvent` schema |
| `sentAt` | date-time | When the notice was sent |
| `metadata` | object | Domain-keyed correlation context (opaque) |

`metadata.intake.verificationId` carries the Intake Verification ID so Intake can correlate the notice back without a separate lookup.

**Intake reaction:** Intake subscribes to `communication.notice.sent` and appends `{ noticeId, type, sentAt }` to the relevant Verification's `documentRequests[]`.

---

## Key Design Decisions

### Decision 1: Event-driven triggers — not RPC

**Status:** Decided

**What's being decided:** Whether other domains trigger notices via direct API calls to Communication or via domain events.

**Decision:** Domain events. The calling domain has no dependency on Communication's API. Adding a new notice type requires no change to the producing domain — only a new subscription in Communication. This is consistent with the event-driven pattern in `docs/architecture/inter-domain-communication.md`.

---

## Key Design Questions

- **Notice lifecycle** — What states and transitions does a notice go through? Which transitions require supervisor approval?
- **Delivery channels** — How are multiple delivery methods (postal, email, portal) modeled? Per-notice or per-delivery-record?
- **Template system** — How do notice templates connect to the `type` field and field metadata?
- **Retry behavior** — How are failed deliveries retried?

---

## Contract Artifacts

| Artifact | Status | Notes |
|----------|--------|-------|
| OpenAPI spec | Alpha | `communication-openapi.yaml` — shell spec; declares `communication.notice.sent` in `x-events`. No REST paths yet. |
| Event schemas | Defined | `schemas/communication-events.yaml` — `NoticeSentEvent` |
| State machine YAML | TBD | Notice lifecycle |
| Rules YAML | TBD | Routing rules, retry policies |
| Metrics YAML | TBD | Delivery success rates, time-to-send |

---

## Related Documents

| Document | Description |
|----------|-------------|
| [Domain Design](../domain-design.md) | Communication section in the domain overview |
| [Inter-Domain Communication](../inter-domain-communication.md) | Command vs. event pattern decision rule |
| [Contract-Driven Architecture](../contract-driven-architecture.md) | Contract artifacts and the adapter pattern |
