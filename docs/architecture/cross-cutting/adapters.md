# Adapter Pattern

## Overview

An adapter connects the blueprint to an external system a state may not control — a rules engine, a legacy case management platform, a workflow system, a transcription service, or any other backend with its own API. The adapter contract defines the interface between the blueprint and that system; the state implements whatever translation is needed to satisfy it.

Adapters come in two kinds:

- **Request and answer:** a stateless HTTP service. Each call is one request and one answer, such as an eligibility determination. Most of this page is about this kind.
- **Running:** the implementation of one resource, working over time with an outside system, such as a transcription session streaming to a transcription service. See [A running adapter](#a-running-adapter).

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

All adapter request and response schemas extend the base schemas defined in `packages/blueprint-core/base-contracts/components/adapter.yaml`:

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

## A running adapter

Some work doesn't fit one request and one answer. A transcription session streams audio to a transcription service for as long as a conversation lasts: it connects, gets text back line by line, loses the connection and gets it back, and finishes when it's told to stop. The adapter for that service isn't something the session asks a question of. It's how the session does its work, so it's the session's implementation for that service.

A running adapter works in two directions:

- **Calls in.** The resource calls the adapter's operations to start, pause and stop it. They're in the adapter's contract, so a state can write an adapter from the contract alone. Each answers at once (`202`), and the work goes on after.
- **Events out.** The adapter reports only by publishing the resource's own events with `publishEvent`: connected, a line finished, disconnected, ended. They're declared under the resource's `emits:`, described as published by the adapter, and the resource follows them under `on:`.

Prior art: hexagonal architecture (ports and adapters, from Alistair Cockburn). An application defines its own interfaces at its edges, called ports. A *driving* port is how the outside uses the application, as an app calls the session's start and stop. A *driven* port is how the application uses the outside: an interface the application defines and calls, which an adapter implements for one outside system, as the session's `startStream`, `pauseStream` and `stopStream` are. In the classic pattern, a driven adapter answers through the port's return values. Here the adapter reports by publishing the application's events instead, because what it reports goes on happening after the call returns.

The resource's API has no operations for the adapter. That API is what the resource's consumers call, an app starting and stopping a session, and a report from the adapter is something that happened, not a request. Putting reports on the API as actions mixes the two: the API lists operations no app should call, and the adapter looks like an outside client of the thing it implements.

### When to use one

Use a running adapter when all of these hold:

- **The work goes on over time** with the outside system: a stream, a call, a long-lived connection.
- **The outside side produces results and changes as they happen** — a line heard, a dropped connection, the end — not one answer.
- **The resource's state follows what happens outside,** as a session's connected, disconnected and closed do.

Use something else when:

| Situation | Use instead |
|---|---|
| One request and one answer | A request-and-answer adapter |
| A long job that ends in one result, such as a document processed in the background | An async command through Data Exchange |
| The outside system already publishes events the blueprint can receive | Subscribe to them under `on:`, with no adapter between |
| The adapter would have to keep data itself | Keep it in a resource that follows the adapter's events, as the transcript keeps the lines |

### Keeping its events reliable

Three rules keep the events reliable:

- **One resource's events stay in order:** the adapter puts the resource's id on each as `subject` and `partitionkey`.
- **A report published twice is kept once:** a report that may be published again after a network error carries a key, and whatever keeps it keeps it once by that key.
- **Following still happens when the adapter can't be told:** when the resource follows something that already happened elsewhere, such as its transcript closed by a supervisor, and tells its adapter to stop, a failed call to the adapter doesn't stop it from following.

What a running adapter publishes is a fact about the adapter, not about anything it reports to: see [who publishes an event](../inter-domain-communication.md#who-publishes-an-event). When it runs outside the server, as in a browser, see [events from outside the server](../inter-domain-communication.md#events-from-outside-the-server).

In demos and tests, stub the adapter's operations and play the adapter by publishing the resource's events, as the transcription scenarios do, or answer its operations in the page with a reference adapter routed as a handler module, as the explorer's example Whisper adapter is ([`packages/blueprint-explorer/examples/session-adapters/whisper.js`](../../../packages/blueprint-explorer/examples/session-adapters/whisper.js)).

The transcription session adapter (`communication-transcription-sessions-adapter-openapi.yaml`) is the first. Its streaming part is the running adapter, and its credentials part, a request-and-answer adapter of its own, issues the short-lived credential the streaming part connects with.

## Contract artifacts

| Artifact | File |
|---|---|
| Base schemas | `packages/blueprint-core/base-contracts/components/adapter.yaml` |

