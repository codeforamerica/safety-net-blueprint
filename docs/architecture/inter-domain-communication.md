# Inter-Domain Communication

The Safety Net Blueprint uses a pub/sub, event-driven model for cross-domain coordination. Domains are loosely coupled — each domain publishes events when its state changes; other domains subscribe and react independently. No domain needs to know who is consuming its events, and adding a new consumer requires no change to the producer.

---

## Event Model

### CloudEvents envelope

All blueprint events use the [CloudEvents 1.0](https://cloudevents.io/) envelope. Key attributes:

| Attribute | Description |
|-----------|-------------|
| `id` | Unique event identifier |
| `type` | Event type — `org.codeforamerica.safety-net-blueprint.{domain}.{entity}.{verb}` |
| `source` | Domain that produced the event — `/intake`, `/workflow`, etc. |
| `subject` | Entity ID the event pertains to |
| `time` | When the event occurred |
| `data` | Event payload (domain-specific) |
| `traceparent` *(optional)* | W3C Trace Context header propagated from the triggering request or event; carries a trace ID (stable across the full causal chain) and parent ID (immediate parent) |

State partners may overlay the `type` prefix to match their own namespace.

### Event contracts

Event contracts for each domain live in two artifacts:

- **OpenAPI spec** (`x-events` section) — declares each event's CloudEvents type name and payload schema reference
- **State machine** — declares which hooks emit which events. Three hooks are available: `onCreate` (object creation), `onUpdate` (field changes outside a transition), and `transitions` (state changes and non-state-changing actor actions)

AsyncAPI specs are generated from these two sources. State partners do not author AsyncAPI directly — they overlay the source artifacts and regenerate.

### Event emission model

Two complementary patterns determine when events are emitted:

**1. CRUD auto-emit (REST handlers)**

Every REST resource emits three lifecycle events automatically — no state machine declaration required:

| Trigger | Event action | Payload (`data`) |
|---------|-------------|------------------|
| `POST /resources` | `{object}.created` | Full resource snapshot |
| `PATCH /resources/{id}` | `{object}.updated` | `{ changes: [{ field, before, after }] }` |
| `DELETE /resources/{id}` | `{object}.deleted` | `null` |

The `before` and `after` values in `updated` events record field-level changes so consumers can react to specific mutations without fetching the full resource.

**2. Declarative state machine events (RPC transitions)**

Transitions declare their own events explicitly in the state machine YAML. Each `type: event` effect specifies the action verb and any payload fields to include — typically context values from `$request.*` or `$caller.*`:

```yaml
- type: event
  action: claimed
  data:
    assignedToId: $caller.id
```

All events — both auto-emitted and declarative — use the same `emitEvent()` utility, which constructs the CloudEvents envelope, persists it to the shared `/platform/events` log, and broadcasts it over the SSE stream.

The `type` field is always derived implicitly: `org.codeforamerica.safety-net-blueprint.{domain}.{object}.{action}`. There is no ambiguity about what constitutes a valid type — it always reflects a real operation on a real resource.

**What does not emit events**

- `GET` requests (read operations) never emit events — only state-changing operations do
- Events are not emitted by the state machine at creation time — the REST create handler handles this universally

---

## `/events` Endpoint

The blueprint exposes a centralized `/events` endpoint as a queryable event log. It serves two purposes:

1. **Audit and history** — brokers have retention limits and aren't designed for time-range queries. The `/events` endpoint provides a permanent, queryable record regardless of how events are delivered in real time.
2. **Polling-based delivery** — states not yet running a message broker poll `/events` in place of broker subscriptions.

### Cross-domain correlation

Every event carries the entity ID as the CloudEvents `subject`. Because every domain uses the same subject for the same entity, a single query returns a complete cross-domain timeline:

```
GET /events?subject=00000004-0000-4000-8000-000000000001
```

Filtering by `type` or `source` narrows results to a specific domain or event kind.

#### Distributed tracing

Conforming implementations must propagate the W3C Trace Context `traceparent` header from each inbound HTTP request to every event emitted during that request's lifecycle. The `traceparent` value is included as a CloudEvents extension attribute (per the [CloudEvents Distributed Tracing extension](https://github.com/cloudevents/spec/blob/main/cloudevents/extensions/distributed-tracing.md)) and must not be modified — it carries a trace ID (stable across the full causal chain) and a parent span ID (the immediate parent operation).

Clients must forward the `traceparent` header on all requests to enable end-to-end tracing. When an inbound request carries no `traceparent`, the implementation omits the attribute from emitted events rather than generating a synthetic value.

The trace ID is stable across the entire chain — every event emitted from a single HTTP request shares the same trace ID, so the complete causal trail for any operation is recoverable by filtering events on `traceparent` prefix or by querying an OTLP-compatible backend.

---

## URL Structure

Every domain API uses a domain-prefixed base path declared in the `servers` entry of its OpenAPI spec:

| Domain | Base path |
|--------|-----------|
| Intake | `/intake` |
| Workflow | `/workflow` |
| Platform (events, search) | `/platform` |

Domain identity is explicit in every URL — in logs, traces, gateway routing rules, and documentation. Path-based routing is the standard pattern for API gateways.

Prefixes are declared in the `servers` entry of each OpenAPI spec and can be overlaid by state partners. A state that prefers `/shared` over `/platform`, or `/benefits/intake` over `/intake`, changes the `servers` entry and regenerates — no paths within the spec change.

---

## Event Versioning

Pub/sub creates semantic coupling — payload shape is a contract. New fields may be added to an event without versioning. Breaking changes (removed or renamed fields) require a new version.

The `.v2` suffix convention on the event type is common (used by Confluent, AWS EventBridge, and others) and keeps the version visible in routing rules and logs:

```
org.codeforamerica.safety-net-blueprint.intake.application.submitted
org.codeforamerica.safety-net-blueprint.intake.application.submitted.v2
```

Both types are published in parallel until all consumers have migrated. The old type is then retired.

CloudEvents also includes an optional `dataschema` attribute for linking to a schema definition (e.g., a schema registry URL). This keeps type names stable across versions and is more aligned with the CloudEvents design intent, but requires a schema registry or stable schema URLs to be useful.

---

## Implementation Path

The target architecture is pub/sub with CloudEvents messages. Most implementations won't start there.

**Step 1 — REST polling on `/events`:** Producers write events to the `/events` store directly. Consumers poll the endpoint on a schedule, tracking position with a cursor. When a broker is in place, producers publish to broker topics and polling is replaced by subscriptions; the `/events` endpoint remains for audit queries.

**Step 2 — Pub/sub:** Producers publish to broker topics; consumers subscribe and receive events in real time. AWS EventBridge, SNS/SQS, Azure Service Bus, and Google Cloud Pub/Sub all support CloudEvents natively. Migration from Step 1 requires no event contract changes — only the delivery mechanism changes.

---

## Further Reading

- [ADR: Inter-Domain Communication](../decisions/inter-domain-communication.md)
- [CloudEvents Specification](https://cloudevents.io/)
- [CloudEvents Extension Attributes](https://github.com/cloudevents/spec/blob/main/cloudevents/documented-extensions.md) — including `traceparent`
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [AsyncAPI Specification](https://www.asyncapi.com/)
