# Communication Domain

> **Status:** Transcripts are built; sending messages is not yet designed.

See [Domain Design Overview](domain-design.md) for context, and [Contract-Driven Architecture](../contract-driven-architecture.md) for the
contract approach.

## Overview

The Communication domain covers what passes between an organization and the
people it serves:

- **Messages sent to them** — by email, text message, mail or a portal. Any
  domain can cause one; Communication reacts to that domain's events and
  handles delivery, so the domain that caused it doesn't depend on how it's
  sent.
- **The record of conversations with them** — a transcript of who said what,
  and when, from a call, a meeting, a chat or an interview. See
  [Communication: Transcripts](communication-transcripts.md).

## Notices

The safety net contracts define notices, official correspondence about an
application or case.

### Entity model

#### Notice

An official communication sent to a client (full schema TBD).

### Domain events

#### How notices are triggered

Communication sends notices by subscribing to domain events rather than receiving direct API calls. The producing domain emits an event when its own state changes; Communication reacts independently. No calling domain has a compile-time or runtime dependency on the Communication API contract.

This is consistent with the decision rule in [`docs/architecture/inter-domain-communication.md`](../inter-domain-communication.md): use a command only when the caller needs a result to continue its operation. Sending a notice is a fire-and-observe side effect, not a blocking dependency.

##### Inbound: `intake.verification.created` (document-type)

Communication subscribes to this event filtered by `verificationType === 'document'`. When a document-type Verification is created — either at application submission (e.g., residency) or as a fallback after an inconclusive electronic check — Communication sends a document request notice to the applicant.

##### Outbound: `communication.notice.sent`

Emitted after a notice is sent.

| Field | Type | Notes |
|-------|------|-------|
| `noticeId` | uuid | The notice record ID |
| `type` | enum | Template identifier — see `NoticeSentEvent` schema |
| `sentAt` | date-time | When the notice was sent |
| `metadata` | object | Domain-keyed correlation context (opaque) |

`metadata.intake.verificationId` carries the Intake Verification ID so Intake can correlate the notice back without a separate lookup.

**Intake reaction:** Intake subscribes to `communication.notice.sent` and appends `{ noticeId, type, sentAt }` to the relevant Verification's `documentRequests[]`.

### Contract artifacts

In the safety net contract set, `safety-net-contracts/src/domains/communication/`.

| Artifact | Status | Notes |
|----------|--------|-------|
| OpenAPI spec | Alpha | `communication-openapi.yaml` — shell spec. No REST paths yet. `communication.notice.sent` is a placeholder in `communication-asyncapi.yaml` until the notice resource and its state machine exist. |
| Event schemas | Defined | `communication-asyncapi.yaml` — `NoticeSentEvent` |
| State machine YAML | TBD | Notice lifecycle |
| Rules YAML | TBD | Routing rules, retry policies |
| Metrics YAML | TBD | Delivery success rates, time-to-send |

### Key design decisions

| # | Decision | Summary |
|---|---|---|
| 1 | [Event-driven triggers — not RPC](#decision-1-event-driven-triggers--not-rpc) | Notices are sent in reaction to other domains' events |

#### Decision 1: Event-driven triggers — not RPC

**Status:** Decided

**What's being decided:** Whether other domains trigger notices via direct API calls to Communication or via domain events.

**Decision:** Domain events. The calling domain has no dependency on Communication's API. Adding a new notice type requires no change to the producing domain — only a new subscription in Communication. This is consistent with the event-driven pattern in `docs/architecture/inter-domain-communication.md`.

### Key design questions

- **Notice lifecycle** — What states and transitions does a notice go through? Which transitions require supervisor approval?
- **Delivery channels** — How are multiple delivery methods (postal, email, portal) modeled? Per-notice or per-delivery-record?
- **Template system** — How do notice templates connect to the `type` field and field metadata?
- **Retry behavior** — How are failed deliveries retried?

## References

- [Domain Design](domain-design.md) — Communication section in the domain overview
- [Communication: Transcripts](communication-transcripts.md) — the transcripts capability
- [Inter-Domain Communication](../inter-domain-communication.md) — command vs. event pattern decision rule
- [Contract-Driven Architecture](../contract-driven-architecture.md) — contract artifacts and the adapter pattern
