# Adapter Pattern

## Overview

An adapter is a stateless HTTP service that connects the blueprint to an external system a state may not control — a rules engine, a legacy case management platform, a workflow system, or any other backend with its own API. The adapter contract defines the interface between the blueprint and that system; the state implements whatever translation is needed to satisfy it.

Adapters are a first-class architectural element of the blueprint. They are the primary integration point between the blueprint and state-managed or vendor systems.

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

## Contract artifacts

| Artifact | File |
|---|---|
| Base schemas | `packages/contracts/components/adapter.yaml` |

