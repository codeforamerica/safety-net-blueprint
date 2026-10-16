# Platform (Cross-Cutting)

> **Status: built.** The platform domain's contracts are in the framework's base
> contracts (`blueprint-core/base-contracts/domains/platform/`), and every
> contract set gets them.

See [Contract-Driven Architecture](../contract-driven-architecture.md) for the
contract approach, and the [contract files conventions](../../conventions/contract-files.yaml)
for how framework files sit beside a set's own.

## Overview

The platform domain is the infrastructure every contract set shares, whatever
its programs and domains: one log of every event every domain sends, and the
named, citable entries — regulatory policies, design patterns — the contracts
declare. It owns no business process and no lifecycle. A capability with
business meaning, such as communication, is a domain of its own that a set opts
into, not part of the platform; the platform is what is left when every domain
is taken away.

## What every contract set gets

1. Every event any domain sends lands in one log, in the order it happened.
   Anyone can read it, narrow it to one record or one causal chain, or follow it
   as it happens. An event from outside the contracts — an adapter reporting a
   result — can be published to it.
2. Every registry the contracts declare can be read by type: which types there
   are, the entries of one, and a single entry. A new registry type is readable
   the moment a file declares it, with no endpoint written for it.

## Entity model

### Event

A record that something happened, in the CloudEvents envelope: which domain
sent it, about which record, when, caused by what, and as part of which trace.
An event is never changed after it is written, and is not a resource with a
lifecycle — it carries no timestamps of the store's own. Recording what
happened, rather than current state, is what lets a reader reconstruct a causal
chain across domains after the fact.

### Registry entry

A named entry of a declared type — a policy citation, a design pattern — with a
description and whatever fields its type defines. Entries live in registry
files; the platform serves them and never stores them, so the contracts are the
only place an entry is written and the only place one changes.

## Domain events

The platform sends none of its own. Publishing an event to the log is the event:
it does not also send an event about the event.

## Contract artifacts

All in `blueprint-core/base-contracts/domains/platform/`.

| Artifact | File |
|---|---|
| API — the event log | `platform-events-openapi.yaml` |
| API — registries, read by type | `platform-registries-openapi.yaml` |

A set's own registry files — `*-registry-{type}.yaml`, in any domain — are what
the registries API serves.

## Key design decisions

| # | Decision | Summary |
|---|---|---|
| 1 | [The event log belongs to the framework](#decision-1-the-event-log-belongs-to-the-framework) | Every set gets it; no set declares its own |
| 2 | [Registries are served from their files](#decision-2-registries-are-served-from-their-files) | One generic API for every registry type, nothing stored |
| 3 | [The platform is infrastructure only](#decision-3-the-platform-is-infrastructure-only) | Business capabilities are domains a set opts into |

### Decision 1: The event log belongs to the framework

**Status:** Decided: B

**What's being decided:** Every domain's events have to be readable in one
place for a causal chain to be followed across domains, so where the log's
contract lives decides whether every set has the same one.

**Considerations:**
- A log each set declares for itself drifts: filters, paging and streaming
  would differ from set to set, and so would every client reading them.
- Every set needs it; none has a reason to change its shape.

**Options:**
- **(A)** Each contract set declares its own event log API.
- **(B) ✓** The framework provides it in the base contracts, and a set declaring
  the same routes is refused as a duplicate.

### Decision 2: Registries are served from their files

**Status:** Decided: B

**What's being decided:** Registries are lists the contracts declare — policies,
patterns, services — and how they are read decides whether each new type needs
an API written for it.

**Considerations:**
- Registry types are added often, by any domain; an endpoint per type is work
  that adds nothing.
- An entry has one source of truth — its file — so a stored copy could only
  drift from it.

**Options:**
- **(A)** An API, and a stored collection, per registry type.
- **(B) ✓** One generic API reading every registry file by type. Files of one type
  combine, and an entry id declared twice fails at boot.

### Decision 3: The platform is infrastructure only

**Status:** Decided: B

**What's being decided:** Shared capabilities like communication are used by
several domains, and putting them on the platform would make every set carry
them.

**Considerations:**
- A capability has business meaning, a lifecycle and its own decisions; the
  event log and registries have none.
- A set that does not transcribe interviews should not carry transcript
  contracts.

**Options:**
- **(A)** Shared capabilities live on the platform domain.
- **(B) ✓** The platform holds only infrastructure. A capability is a framework
  domain of its own, included when a set lists it in its configuration's
  capabilities.

## Customization

| Element | Reason | Decision |
|---|---|---|
| One event log for every domain | Following a causal chain across domains depends on it | [Decision 1](#decision-1-the-event-log-belongs-to-the-framework) |
| Registries read from their files | An entry has one source; a stored copy would drift | [Decision 2](#decision-2-registries-are-served-from-their-files) |

### Event types

A state deploying alongside other systems on a shared bus can prefix every event
type, declared once in its configuration, so its events are distinguishable from
everyone else's.

### Registries

A set adds a registry type, or entries to an existing one, with a registry file
of its own, in whichever domain the entries belong to.

## Out of scope

- **Search** — a contract set's own concern; see [Search](search.md).
- **Identity and access** — see [Identity & Access](identity-access.md).
- **Timers** — see [Scheduling Service](scheduling-service.md).
- **Capabilities such as communication** — framework domains of their own; see
  [Transcripts](transcripts.md).

## Capability coverage

| Capability | Industry standard | Blueprint status |
|---|---|---|
| A cross-domain event log | Event stores and audit trails in case management platforms | partial — read, narrowed, streamed and published; retention is the implementation's |
| Reference data by type | Lookup tables and reference data services | partial — read-only, from the contracts |

## References

- [CloudEvents 1.0](https://cloudevents.io/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [Inter-Domain Communication](../inter-domain-communication.md)
- [Transcripts](transcripts.md)
