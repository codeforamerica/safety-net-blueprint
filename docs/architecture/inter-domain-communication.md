# Inter-Domain Communication

The Safety Net Blueprint uses two distinct patterns for cross-domain communication: **commands** and **domain events**. Choosing the right pattern is a contract decision — it determines coupling, testability, and what consumers can rely on.

## Principles

### Keep PII in the owning domain

Don't copy PII or sensitive fields onto another domain's records — that expands the governance surface without adding a governance boundary. When a domain needs another domain's PII, use it transiently, not as persisted fields. See [PII in cross-domain data sharing](#pii-in-cross-domain-data-sharing).

### Govern what crosses domain boundaries with a schema

What enters and exits a domain boundary should be governed by a schema. We prefer patterns where the producing domain assembles and exposes a purpose-built view — when consumers assemble their own inputs by querying another domain, that behavior is outside the contract layer and can't be validated, versioned, or tested.

### Put assembly logic in the domain that holds the data

Put data assembly in the producer, not the consumer. When consumers reach into a producer's internals to compose a view, they couple to the internal model — changes to the producer break the consumer. The producer should expose a stable, composed interface.

### Cross-domain writes: authoritative source, fire-and-forget

Allow one domain to write directly into another only when two conditions hold: the writing domain is the authoritative source for the data, and the write is fire-and-forget. When either condition is absent, the write creates coupling in the wrong direction.

### Treat event schemas as public contracts

Event payload shapes are contracts the moment a consumer subscribes. Additive changes (new fields) are safe; breaking changes (removed or renamed fields) require a new event version.

---

## Choosing a pattern

**Use a command when the calling domain needs a result to continue its own operation.**

A command is a direct synchronous API call. The caller sends a request and uses the response before proceeding. The relationship is explicit: the caller depends on the target domain's API contract. Commands are appropriate when the result must be known in the same request — uploading a document and receiving the document ID to attach to a verification record is a command.

**Use a domain event when notifying that something happened.**

A domain event is an async signal. The producing domain has no knowledge of who consumes it or what they do. Consumers subscribe and react independently; adding a new consumer requires no change to the producer. Domain events are appropriate when the producing domain's operation is already complete and others may optionally react — an application being submitted is a domain event.

**The async command variant**

Some interactions combine both patterns: a command initiates a long-running operation, and an async domain event delivers the result when it is ready. Data exchange verification calls use this variant — intake creates a service call (command), the external service responds asynchronously, and a domain event delivers the result when it arrives. The context passthrough pattern (see `api-patterns.yaml`) is used to correlate the result event back to the originating record.

**Decision rule**

> Does the calling domain need a result from the other domain to complete its current operation? → Command. Is the calling domain notifying that its own state changed? → Domain event.

If neither fits cleanly, the interaction may be a candidate for the async command variant.

**The cross-domain seeding variant** <a name="cross-domain-seeding"></a>

Some interactions require one domain to write records directly into another domain — not to trigger a reaction, but to seed the second domain's records with data only the first domain holds at that moment.

A cross-domain write is acceptable only when both conditions are met:

1. **The writing domain is authoritative** — the data being written is owned by the writing domain at the time of the write. It is not copying data it received from elsewhere; it is the original source.
2. **The write is fire-and-forget** — the writing domain does not need a result. No synchronous dependency is introduced.

When both conditions are met, a cross-domain write is simpler than the alternative (an event chain requiring the receiving domain to subscribe and query back). When either condition is absent, a cross-domain write creates coupling in the wrong direction and should not be used.

**Baseline example — Intake seeding Eligibility at submission:** At application submission, Intake creates the Determination and Decisions in the Eligibility domain, pre-populated with application data snapshots. Intake is authoritative for application data at that moment; the write is fire-and-forget (Intake does not wait for Eligibility to respond). Both conditions are met. See [Eligibility Decision 12](domains/eligibility.md#decision-12-who-creates-determination-and-decision-records).

**Reverse direction — Eligibility writing back to Intake:** Eligibility writing determination outcomes back to Application Member records (as a denormalized copy for caseworker-facing display) is also acceptable. Eligibility is authoritative for outcomes; the write is fire-and-forget. Both conditions are met.

**Counter-example:** A domain writing records into another domain and then subscribing to the result of that write violates condition 2. A domain writing data it received from a third domain violates condition 1. Neither is a cross-domain write — they are coupling in disguise.

**The commanded snapshot pattern** <a name="commanded-snapshot-pattern"></a>

Some interactions require one domain to maintain a consumer-specific read model that another domain can trigger a refresh of on demand — a purpose-built view assembled from the owning domain's current state, shaped for one consumer's exact needs.

A commanded snapshot resource:
- Is owned by the domain that holds the authoritative data, which is also responsible for the quality and shape of the view
- Is shaped for the consuming domain's specific use case — assembled from the owning domain's internal model, not a copy of it
- Uses PUT upsert semantics: the consumer calls PUT to initialize or refresh it; the owning domain assembles the current view and returns it
- Keeps PII and sensitive data within the owning domain's boundary — the consuming domain's records never persist the raw fields

This pattern applies all three principles simultaneously:

- **Bounded context isolation:** The snapshot lives in the producing domain; PII stays within that domain's governance boundary.
- **Contract coverage:** The snapshot schema governs exactly what data reaches the consuming domain and its adapter. When assembly logic lives inside an adapter, it is outside the contract layer — unobservable and ungovernable. Bringing assembly into the owning domain makes the full data flow schema-governed.
- **Assembly knowledge in the owning domain:** The consumer calls one endpoint and receives a pre-built payload. It does not need to know which internal resources the producing domain queries, how to join them, or which fields to map. Changes to the producing domain's internal model do not reach the consumer.

**When to use:** The consuming domain needs pre-assembled data from another domain at a specific moment (e.g., before calling a vendor adapter); the consumer controls when a refresh is needed; and current-at-refresh is sufficient (real-time synchronization is not required).

**Baseline example — `EligibilitySnapshot`:** Intake owns the `EligibilitySnapshot` resource per application. The Eligibility rules engine calls `PUT /intake/applications/{id}/eligibility-snapshot` before each evaluate call; Intake assembles the current household and member data and returns it. PII stays in Intake; the eligibility adapter receives a pre-built, schema-governed payload without making cross-domain queries at evaluation time. See [Eligibility Decision 13](domains/eligibility.md#decision-13-application-data-snapshot).

Name consumer-facing snapshot resources using the [`{ConsumerDomain}Snapshot` naming convention](api-architecture.md#consumerdomain-snapshot-naming-convention).

---

## Domain Events

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
| `causationid` *(optional)* | CloudEvents Causation extension. The `id` of the event that directly caused this one. Use when an event is emitted in direct response to another event — e.g., a task auto-resumed because a timer fired. Complements `traceparent`: `traceparent` covers the full distributed trace; `causationid` names the immediate parent event specifically. |
| `authtype` *(optional)* | CloudEvents Auth Context extension. Principal type of the actor who triggered the event. Required when `authid` is present. Values: `user`, `service_account`, `api_key`, `system`, `unauthenticated`, `unknown`. Required for FTI-governed events per IRS Pub. 1075. |
| `authid` *(optional)* | CloudEvents Auth Context extension. Principal identifier (userId from JWT claims) of the actor who triggered the event. No PII — user ID only, not name or email. Required for FTI-governed events per IRS Pub. 1075. |

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
| `PUT /resources/{id}` (upsert) | `{object}.created` (201) or `{object}.updated` (200) | Full resource snapshot in both cases — PUT replaces the full resource, so the event carries the complete new state rather than a field diff (consistent with Stripe, GitHub, and Cosmos DB) |

The `before` and `after` values in `updated` events record field-level changes so consumers can react to specific mutations without fetching the full resource. **Exception: PUT upsert** — because the caller always provides the full replacement value, the `updated` event carries the complete new resource snapshot rather than a field diff. This is consistent with how REST-native webhook systems (Stripe, GitHub, Cosmos DB) handle full-replacement operations. Consumers subscribing to `updated` on a `singleton_upsert` resource should expect a full snapshot, not a diff.

**2. Declarative state machine events (RPC transitions)**

Transitions declare their own events explicitly in the state machine YAML. Each `type: event` effect specifies the action verb and any payload fields to include — typically context values from `$request.*` or `$caller.*`:

```yaml
- type: event
  action: claimed
  data:
    assignedToId: $caller.id
```

All events — both auto-emitted and declarative — use the same `emitEvent()` utility, which constructs the CloudEvents envelope, persists it to the shared `/platform/events` log, and broadcasts it over the SSE (Server-Sent Events) stream.

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

#### Event causation

When an event is emitted directly in response to another event, producers set the `causationid` extension attribute to the `id` of the triggering event. This is distinct from `traceparent`: `traceparent` links the entire distributed trace; `causationid` names the specific event that caused this one.

Use `causationid` when a consumer needs to identify the immediate trigger without parsing the full trace — for example, a task auto-resumed by a timer carries the timer event ID in `causationid`, allowing a subscriber to look up the original timer context without domain-specific payload fields in the workflow event.

`causationid` is optional. Producers set it only when the event is causally linked to another event. Events triggered by direct user action (HTTP requests) do not set `causationid` — use `traceparent` for those.

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

Pub/sub (publish/subscribe — a messaging pattern where producers broadcast events to topics and any number of consumers can subscribe independently) creates semantic coupling — payload shape is a contract. New fields may be added to an event without versioning. Breaking changes (removed or renamed fields) require a new version.

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

## PII in cross-domain data sharing <a name="pii-in-cross-domain-data-sharing"></a>

Three patterns are acceptable when a domain needs PII held by another domain. See [Bounded context boundaries as governance boundaries](#bounded-context-boundaries-as-governance-boundaries) for the underlying principle.

**1. Commanded snapshot** — The owning domain materializes a purpose-built read model for a specific consumer. The consumer calls PUT to initialize or refresh it; the owning domain assembles the current data and returns it. PII stays in the owning domain; the consumer receives a pre-built, schema-governed payload. This is the preferred pattern when the consumer needs pre-assembled data at a specific moment (e.g., before calling a rules engine adapter). See [commanded snapshot pattern](#commanded-snapshot-pattern).

*Baseline example:* `EligibilitySnapshot` — Intake assembles household and member application data for the Eligibility rules engine. PII stays in Intake. See [Eligibility Decision 13](domains/eligibility.md#decision-13-application-data-snapshot).

**2. Direct query** — The consuming domain queries the owning domain's standard API endpoints at runtime using system credentials. PII stays in the owning domain; the consumer fetches what it needs when it needs it. Appropriate when the consumer is part of the adapter layer and the query is scoped to a specific runtime operation.

*Baseline example:* Data exchange adapters query Intake using system credentials before calling external services. See [Data Exchange Decision 13](domains/data-exchange.md#decision-13-no-pii-in-request-payload).


---

## PII in event payloads

Event payloads may contain PII, FTI (Federal Tax Information), or PHI (Protected Health Information). How states safeguard this data in their event infrastructure is an implementation concern, not a blueprint contract concern — the blueprint does not prescribe an encryption mechanism, access control policy, or key management approach.

The blueprint's responsibility is to mark which fields are sensitive so that adapters know what requires protection. Schema fields carrying regulated data are annotated with `x-data-classification` (see [api-patterns.yaml](../../packages/contracts/patterns/api-patterns.yaml)). Classifications: `pii`, `fti`, `phi`.

States are responsible for:
- Applying appropriate safeguards to classified fields in event payloads (encryption, access control, log masking)
- Meeting regulatory requirements for the classifications present in their deployment (IRS Pub. 1075 for `fti`, HIPAA for `phi`)
- Ensuring their event store and broker infrastructure meets those requirements

---

## Design Decisions

### Domain events — scope

**Status:** Decided: publish as needed

**What's being decided:** Whether to limit events to lifecycle state transitions only, or also publish events for significant data changes within a stable state.

**Considerations:**
- Salesforce CDC automatically publishes externally accessible change events for any enabled object via the Pub/Sub API — a genuine CDC subscription model. Cúram and Pega both require explicit developer instrumentation per event (outbound SOAP calls or Kafka publish steps wired into flows); they do not offer automatic data mutation event streams.
- Transition events have stable, minimal payloads. Data mutation events carry more model detail and require more care to evolve.
- The main governance concern with data mutation events is **semantic coupling**: consumers depend on the event payload shape; renaming or restructuring fields is a breaking change. Mitigations: additive-only payload evolution, event type versioning (`v1`/`v2`), a schema registry, consumer-driven contract testing, or defining event schemas using the same canonical types as the API specs (already overlayable in the blueprint).
- Adding a new event type is additive and non-breaking — events can be introduced per-domain as integration needs emerge, without a blanket upfront decision.

**Decision:** Both transition and data mutation events are supported. Which specific events to emit is determined per-domain based on real integration needs, governed by the schema evolution practices above.

---

### Audit trail pattern

**Status:** Decided: cross-cutting audit domain

**What's being decided:** How changes to resource data made during active case processing are tracked — and whether each domain owns its own audit trail or delegates to a shared cross-cutting domain.

**Considerations:**
- All major vendors implement audit internally — Cúram versions each evidence update; Pega's case audit framework captures who changed what and when; Salesforce uses field history tracking. None delegate to a separate audit domain, but all are monolithic systems where the concept doesn't exist. The blueprint's domain separation creates the opportunity to do this differently.
- **Option A/B (audit per domain)**: Each domain with mutable data independently implements audit logic — duplicated across intake, case management, eligibility, etc.
- **Option C (cross-cutting audit domain)**: Audit logic lives once; all domains get the same treatment; cross-domain queries ("all changes by this caseworker this week") are possible from one place. Requires mutation events to carry enough payload to reconstruct version history — either the full record at each point (fat events, easy to compare) or changed fields with before/after values (thin events, smaller payloads, audit domain reconstructs state by replaying). Salesforce CDC uses the thin approach.

**Decision:** Cross-cutting audit domain — domains emit mutation events (see CRUD auto-emit above); a dedicated audit domain subscribes and maintains version history across all domains. Cross-domain audit queries are possible from one place without domain-specific implementation.

---

## Further Reading

- [ADR: Inter-Domain Communication](../decisions/inter-domain-communication.md)
- [CloudEvents Specification](https://cloudevents.io/)
- [CloudEvents Extension Attributes](https://github.com/cloudevents/spec/blob/main/cloudevents/documented-extensions.md) — including `traceparent`
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [AsyncAPI Specification](https://www.asyncapi.com/)
