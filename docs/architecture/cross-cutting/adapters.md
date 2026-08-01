# Adapter Pattern

## Overview

An adapter is a stateless HTTP service that connects the blueprint to an external system a state may not control — a rules engine, a legacy case management platform, a workflow system, or any other backend with its own API. The adapter contract defines the interface between the blueprint and that system; the state implements whatever translation is needed to satisfy it.

Adapters are a first-class architectural element of the blueprint. They are the primary integration point between the blueprint and state-managed or vendor systems.

## Two kinds of contract: domain API and adapter

This is an instance of a named, standard pattern — **Ports and Adapters**, also called **Hexagonal Architecture** (Alistair Cockburn, 2005). The pattern's value is decoupling: a domain's core logic depends only on the interfaces (ports) it defines, never on a specific external implementation, so either side can change without touching the other. Concretely here, that's what already lets a mock server stand in for a real state-provided adapter behind the same contract for development and testing, and what lets a state swap Cúram for Corticon (or vice versa) without the Eligibility domain's own logic or API changing at all.

A domain sits between two different kinds of interface:

- **The domain's own API and state machine** (e.g., `eligibility-openapi.yaml`, `eligibility-state-machine.yaml`) is a **primary port** — how the rest of the system (other domains, the front end) calls *into* the domain. This is fixed and universal: every adopter implements it identically, regardless of what's behind it.
- **The adapter contract** (e.g., `eligibility-adapter-openapi.yaml`) is a **secondary port** — how the domain calls *out* to an external system it doesn't control. When the blueprint defines this contract (see [Who defines the adapter contract](#who-defines-the-adapter-contract) below), it is *also* fixed and universal in shape — not one contract per backend vendor or engine architecture.

**What varies is neither contract — it's the concrete implementation behind the secondary port.** Different states can put Cúram, Corticon, or any other rules engine behind the same `eligibility-adapter-openapi.yaml` contract; the contract's shape doesn't change to accommodate them. This is the entire point of the pattern: the domain's own logic and its primary-facing API stay stable while whatever's behind the secondary port is swapped freely. See [Handling backend implementations with varying capability](#handling-backend-implementations-with-varying-capability) for what to do when different backends behind the same secondary port have genuinely different capabilities, not just different implementations of the same capability.

## Who defines the adapter contract

The blueprint, the state, or the open source community can define an adapter contract.

**The blueprint defines the contract** when the integration is a core part of the blueprint's own flow and the data shape is stable enough to specify across states. Two conditions make this feasible:

1. **The call is stateless** — the external system evaluates inputs and returns a result with no side effects on the blueprint's data.
2. **The data shape is well-constrained** — the domain (regulatory requirements, program rules) defines what inputs are needed and what the result looks like.

The eligibility adapter is an example: program eligibility criteria are federally defined, so the request and response shapes are stable across states.

**The state defines the contract** for integrations that are complex, business-rules-heavy, or deeply tied to state-specific systems — for example, a workflow system where process logic varies significantly by state. These integrations are too variable for the blueprint to standardize. The blueprint imposes no requirements on the request or response shape. States can adopt the metadata passthrough pattern and base schemas if they find them useful, but are not required to.

**The community can contribute contracts** for common third-party systems — cloud storage, document services, notification providers, and similar infrastructure. Since the blueprint is open source, adapter contracts for widely used vendors can be contributed back and adopted by any state, just as states can publish their own adapter implementations for others to build on.

## Metadata passthrough

Every adapter request includes a `metadata` field set by the blueprint. The adapter must echo it back unchanged in the response.

**The adapter must not inspect, modify, or depend on the contents of `metadata`.** It is opaque correlation context that the blueprint uses to map the response to its internal records — for example, to identify which Decision record a determination applies to — without exposing resource identities to the adapter.

This separation means:

- The adapter does not need to understand the blueprint's data model
- The blueprint's internal identifiers are never part of the evaluation contract
- The adapter contract remains stable even as the blueprint's internal structure evolves

### Base schemas

All adapter request and response schemas extend the base schemas defined in `packages/contracts/components/adapter.yaml`:

- **`AdapterRequest`** — defines the `metadata` field as optional (the blueprint always sets it; `additionalProperties: true` allows states to pass additional context to their backend system)
- **`AdapterResponse`** — defines `metadata` as required, echoed back unchanged

States implementing an adapter must return `metadata` exactly as received. The simplest correct implementation:

```js
// Express handler example
app.post('/evaluate/determination', (req, res) => {
  const result = myRulesEngine.evaluate(req.body);
  res.json({
    metadata: req.body.metadata,  // echo back unchanged
    program: result.program,
    status: result.status,
  });
});
```

## Responsibilities

For blueprint-defined adapter contracts, the state is responsible for:

1. Implementing the contract the blueprint defines
2. Translating the blueprint's request into whatever shape their backend system expects
3. Translating the backend system's response into the blueprint's response shape
4. Echoing `metadata` back unchanged

The blueprint is responsible for:

1. Assembling and transforming application data into the adapter request shape before calling
2. Setting `metadata` with the correlation data it needs
3. Reading `metadata` from the response to update internal records

For state-defined adapter contracts, the state defines both sides of the contract and is responsible for all of the above. Using the base schemas is optional but recommended — the metadata passthrough pattern is useful for any adapter that needs to correlate responses to internal records.

## Handling backend implementations with varying capability

A single adapter contract can sit in front of genuinely different backend systems — different vendors, different products, sometimes different architectures entirely (see, for example, the eligibility adapter's forward-chaining and backward-chaining rules-engine backends, [Decision Rules DSL](decision-rules-dsl.md)). Those backends don't always have the same ability to answer a given request. A contract that implicitly assumes every backend can produce the same level of detail forces one of two bad outcomes: an implementation fakes a capability it doesn't actually have, or the contract silently only works honestly for one kind of backend.

Two rules keep the contract honest across backends of varying capability:

1. **Capability-dependent response fields must be optional, and their absence must mean "no information available" — never "fully resolved."** An adapter backed by a system that can't populate a field must be able to omit it without that omission being misread as a positive claim (e.g., "nothing is missing" when the backend simply didn't say). Getting this backwards turns a capability gap into a correctness bug for whoever calls the adapter.
2. **Some form of capability declaration is needed** so the calling side doesn't attempt or expose functionality a given adapter can't honor — either the adapter states what it supports, or the caller's own per-deployment configuration records what its configured adapter can do. Without this, the calling side has to discover a capability gap by trial and error (an empty response) rather than knowing in advance.

This is the same "adapter is a black box" principle already established above, extended to the case where different black boxes behind the same contract vary not just in *how* they answer, but in *what* they're honestly able to answer at all.

## Contract artifacts

| Artifact | File |
|---|---|
| Base schemas | `packages/contracts/components/adapter.yaml` |

