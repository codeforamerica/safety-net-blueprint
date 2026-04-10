# ADR: Inter-Domain Communication

**Status:** Decided

**Date:** 2026-04-09

---

## The Problem

A submitted application triggers work across multiple domains simultaneously: a caseworker task, a confirmation notice, expedited eligibility screening. Each concern is owned by a different domain, potentially in a different system or vendor product.

Most states have built these integrations through point-to-point calls or batch file transfers. Point-to-point calls are ephemeral — any audit record must be built as a separate concern. Batch transfers capture state snapshots, not change events: you can't reconstruct what changed between batches, who changed it, or in what order. Neither produces a structured, replayable event history as a first-class output.

---

## Decisions

### Pub/sub event-driven coordination

**Decision:** Domains coordinate via a pub/sub model — producers emit events to per-domain channels; consumers subscribe independently and react.

**Why:** Three requirements drive this:

- **Regulatory audit trails** — federal QC reviews (SNAP, Medicaid) require documentation of who made what eligibility decision, when, and on what basis. Current state alone cannot reconstruct this.
- **Version tracking** — caseworkers need to compare the original submitted application against corrections made during interview and review. Without field-level change history, this view cannot be built.
- **Cross-domain coordination** — multiple independent services must react to the same domain events without tight coupling between them.

**Alternatives rejected:**

- *Direct API calls:* Creates tight structural and temporal coupling — every downstream service's contract must be known to the caller, an outage in one domain blocks another, and adding a consumer requires modifying the caller. Calls are ephemeral, producing no event history — incompatible with audit trail and version tracking requirements.
- *Batch REST polling on resource endpoints:* Returns current state, not change history. Intermediate steps between polls are lost — incompatible with audit trail and version tracking requirements.
- *Webhooks:* Not incompatible with event history requirements, but requires each producing domain to own fan-out delivery — tracking consumer URLs, managing retries, ordering guarantees. That is precisely what a message broker does — the infrastructure underlying the pub/sub model — built from scratch and embedded in the API. Subscription management endpoints, signing secrets, and delivery semantics would be multiplied across every domain.

---

### Choreography over orchestration

**Decision:** Domains react to events independently. No central coordinator directs the sequence of interactions.

**Why:** Each domain publishes events when its state machine transitions; consumers subscribe and act without any change to the producer. Adding a new consumer is additive.

**Alternatives rejected:**

- *Central orchestration:* The full flow is visible in one place, but the orchestrator couples to every domain it coordinates. Every new step or consumer requires modifying it. It becomes a bottleneck and single point of failure. Choreography is the prevailing pattern in modern distributed systems for these reasons.

---

### Centralized `/events` endpoint

**Decision:** The blueprint exposes a single `/events` endpoint. Broker topics are organized per domain (or per resource) independently of the HTTP interface.

**Why a `/events` endpoint:** Brokers have retention limits and aren't designed for arbitrary time-range queries. Reconstructing what happened to a specific application months ago, or comparing original submitted data against corrections, requires a queryable event log — regardless of how events are delivered in real time. The `/events` endpoint is a permanent part of the API contract for this reason. It also serves as a delivery mechanism for states not yet running a message broker, who poll it in place of broker subscriptions.

**Why centralized:** Supports cross-domain correlation — a single query filtered by entity ID returns every event from every domain for that entity, in order.

**Alternatives rejected:**

- *Per-domain `/events` endpoints:* Makes cross-domain correlation harder — consumers must query multiple endpoints and merge results.

---

### CloudEvents 1.0 as the event envelope

**Decision:** All blueprint events use [CloudEvents 1.0](https://cloudevents.io/).

**Why:** CloudEvents is a CNCF standard with native support in AWS EventBridge, Azure Service Bus, Google Cloud Pub/Sub, and Knative. The same envelope works across providers without translation and is transport-agnostic — adopting it doesn't lock in a broker choice. Standard tooling (validators, mock servers, tracing) supports it out of the box.

Event types follow `org.codeforamerica.safety-net-blueprint.{domain}.{entity}.{verb}` — self-contained and collision-safe in shared broker environments. State partners may overlay the type prefix to match their own namespace.

**Alternatives rejected:**

- *Custom envelope:* Every broker, tool, and consumer integration would need custom serialization. Each cloud provider would require format translation.
- *Proprietary broker format:* Simple for one broker; not portable across providers or broker changes.

---

### Domain path prefixes

**Decision:** Every domain API uses a domain-prefixed base path (`/intake/...`, `/workflow/...`) declared in the `servers` entry of each OpenAPI spec. Paths within the spec remain clean; effective URLs include the prefix.

**Why:** Domain identity should be explicit in every URL — in logs, traces, gateway routing rules, and documentation. `/intake/applications` is unambiguous; `/applications` is not. Path-based routing is the standard pattern for API gateways. The `servers` prefix works in both single-host gateway and multi-host independent service deployments.

**Alternatives rejected:**

- *Separate base URLs per domain (e.g., `intake.api.example.com`):* Valid topology — routing is DNS rather than path-based — but leaves contract files ambiguous. Two specs both defining `/events` are indistinguishable without the host, and the host isn't encoded in the spec file itself.
- *No prefix, shared base URL:* Paths collide; no domain signal in URLs.

---

### OpenAPI and state machine as the event contract source of truth

**Decision:** Event contracts live in two artifacts per domain. The **OpenAPI spec** contains an `x-events` section with each event's CloudEvents type name and payload schema reference. The **state machine** declares which hooks emit which events — via `onCreate`, `onUpdate`, and `transitions` (including self-transitions for actor actions that don't change state). AsyncAPI specs are generated from these two sources; state partners do not author AsyncAPI directly.

**Why:** The OpenAPI spec already owns the domain's REST contract and type definitions — co-locating event payload schemas keeps REST and event types in sync. The state machine is already the authoritative record of domain behavior. Both support the existing JSON Patch overlay mechanism, so state partners customize and regenerate, same as REST contracts.

**Alternatives rejected:**

- *Authored AsyncAPI:* AsyncAPI doesn't support JSON Patch overlays. State partners would need to fork and hand-maintain documents.
- *Separate JSON Schema files:* Parallel file structure; drift risk with shared REST schemas.
- *Informal documentation:* No tooling support; event contracts are not machine-readable.

---

### AsyncAPI for event channel contracts

**Decision:** The blueprint generates [AsyncAPI](https://www.asyncapi.com/) specs from its OpenAPI and state machine sources. State partners are not required to adopt it, but adoption is additive and non-breaking.

**Why:** CloudEvents defines the event envelope — what an event looks like. AsyncAPI describes the event API contract — where events flow, who publishes and subscribes, and what broker infrastructure is required. A state partner using CloudEvents alone has interoperable events but no machine-readable contract describing their channels. AsyncAPI provides that layer, making the event API as discoverable, documented, and toolable as their REST API.

The blueprint's TypeScript client pipeline (hey-api + Zod) already generates typed event payload models from OpenAPI component schemas — the same schemas referenced by `x-events`. AsyncAPI adds on top:

- **Channel contract layer** — typed producer/consumer interfaces; hey-api is OpenAPI-only and doesn't cover this
- **Discoverability and documentation** — static HTML documentation for event channels, equivalent to the existing Swagger UI for REST
- **Spec-driven mock extension** — the mock server can use the AsyncAPI spec to automatically configure event channels, validate payloads, and deliver spec-accurate fixtures
- **Infrastructure generation** — AsyncAPI broker bindings enable Terraform, CloudFormation, and Bicep generation from the spec, keeping event contracts and infrastructure in sync

---

## Further Reading

- [CloudEvents Specification](https://cloudevents.io/)
- [CloudEvents Extension Attributes](https://github.com/cloudevents/spec/blob/main/cloudevents/documented-extensions.md) — including `traceparent`
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [AsyncAPI Specification](https://www.asyncapi.com/)
- [AsyncAPI + CloudEvents](https://www.asyncapi.com/blog/asyncapi-cloud-events)
- [Inter-Domain Communication Architecture](../architecture/inter-domain-communication.md)
