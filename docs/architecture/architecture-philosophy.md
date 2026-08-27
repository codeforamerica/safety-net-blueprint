# Architecture Philosophy

For anyone evaluating or adopting this blueprint who wants to understand why it's built the way it is.

## Why this document exists

Individual domain docs and decision logs explain *what* was decided, in the technical detail engineers need to build against them. This document explains the handful of design philosophies that recur across all of them — what each one means in practice, and why this blueprint relies on it.

## Design philosophies

### 1. Contract-first / spec-first design

**Why:** A contract in this blueprint says exactly what an implementation needs to do — not roughly, but completely: what a resource looks like, how a workflow moves through its lifecycle, what the business logic is supposed to produce. That completeness means work doesn't have to happen one step at a time, waiting on a real system to exist first. A vendor can build directly from the contract, without back-and-forth to clarify what's actually required. A mock server can be generated from that same contract, so developers and testers get started right away, against realistic behavior, without waiting for a real backend. And a coding agent can generate an implementation straight from the contract, because the contract already specifies everything the code needs to do. That same completeness is also what lets the requirement outlast whoever's building against it: eligibility rules and workflows change whenever the legislature acts, and the people and vendors responsible for the system change too — staff leave, contracts end, vendors get replaced. Whoever picks up the work next builds from that same precise, complete answer, not a guess reverse-engineered from someone else's code.

**In practice:** A resource's shape, how something moves through its lifecycle — the fixed set of states it can be in, and the specific conditions that allow it to move from one to the next — what decision logic produces an outcome like an eligibility determination or a routing decision, how a multi-step process is sequenced from start to finish, and how data pulled from more than one place gets assembled into a single view for one particular need. All of it is written down and agreed on before anyone builds it, not written afterward to describe whatever the code happened to do.

*Reference:* [OpenAPI-first / design-first API development](https://swagger.io/resources/articles/adopting-an-api-first-approach/).

### 2. Domain-Driven Design

**Why:** A benefits program isn't one undifferentiated thing — intake, eligibility, workflow, and client records are different areas of work, each with its own staff, its own rules, and its own vocabulary. Organizing the system around those same real-world groupings, using the terms the people who run each area already use, makes the system something program staff can recognize and reason about, not just developers. It also keeps the system itself coherent as it grows: each area of work stays a self-contained piece with a clear job, instead of every new feature getting piled into one tangled whole where nobody can change one thing without touching everything else.

**In practice:** The blueprint is organized into domains that mirror how the business itself is organized — Intake, Eligibility, Workflow, Client Management, and so on — each owning its own data and its own rules, so a change in one area doesn't unpredictably ripple into another. One side effect of drawing those boundaries carefully: the same word can mean two different things in two different domains, on purpose. This blueprint has an `Income` entity in both Client Management and Intake, same name, different meaning, and that's safe because each domain is its own self-contained area. Nothing in the blueprint's contracts lets one domain reach into another's storage directly — every cross-domain access goes through the owning domain's own published interface, and that interface has to be one other domains can actually build against, not just technically walled off.

*Reference:* [Evans, *Domain-Driven Design*](https://www.domainlanguage.com/ddd/); [Fowler, "Bounded Context"](https://martinfowler.com/bliki/BoundedContext.html).

### 3. Adapters (Ports & Adapters / Hexagonal Architecture)

**Why:** A state picks a workflow engine, case management platform, or database once, at a single point in time — but lives with that choice for years, long after the conditions that made it the right choice can change: pricing, the vendor's product roadmap, support quality, even whether the vendor is still in business. If business logic calls that vendor directly, leaving gets harder every year that coupling accumulates, until one of those changes leaves the state with no real ability to act. The goal is: swap the vendor, not the logic that depends on it.

**In practice:** The core logic never talks to a vendor directly — a separate, replaceable layer does that translation, so a vendor's own quirks and terminology stay on the vendor's side of the line instead of leaking into the rest of the system. That layer has to genuinely translate the vendor's concepts into the system's own model, not just relay them under a different name — otherwise the vendor's quirks get adopted wholesale, and everything downstream inherits them even after that vendor is gone. And where several parts of the system need to talk to the same category of outside service, they go through one shared door instead of each building their own.

*Reference:* [Cockburn, "Hexagonal Architecture"](https://alistair.cockburn.us/hexagonal-architecture/); [Evans, *Domain-Driven Design*](https://www.domainlanguage.com/ddd/) (anti-corruption layer); [Gang of Four, "Facade"](https://en.wikipedia.org/wiki/Facade_pattern).

### 4. Event-Driven Architecture

**Why:** New consumers of information a domain produces show up throughout the life of a benefits system — a new report, a new downstream process, a new integration nobody anticipated when the domain was first built. One that matters more than most: a benefits decision has to be reviewable after the fact — who changed what, and when — for audits, appeals, and oversight, on a timeline nobody can predict when the domain producing that decision was first built. If adding a consumer like that means going back and modifying the domain that produces the information, the amount of code that has to change grows with every consumer anyone ever adds, and "what happened" ends up tangled together with "what to do about it" in the same place.

**In practice:** A part of the system announces that something happened, with no particular consumer in mind; anything else that cares subscribes and decides independently how to react, with no central coordinator sequencing that reaction across the system. A record of every change across the system — who did what, and when — can be built entirely this way, just by listening to what every domain already announces, rather than asking each domain to separately report to an audit system. That's the same mechanism that lets any other new kind of consumer — a new reporting need, a new downstream process — get added later without the part of the system that announced the event ever needing to change, or even know that consumer exists.

*Reference:* [Fowler, "What do you mean by Event-Driven?"](https://martinfowler.com/articles/201701-event-driven.html)

### 5. Overlay-based customization

**Why:** A state adopting this blueprint starts with a base that already has the common shape of a benefits system built into it — eligibility rules, workflows, and resource shapes it doesn't have to invent or build from scratch. States still need to customize that base to their own programs, rules, and constraints, and the base keeps evolving after they do. If a state customizes by editing the base directly, every future update has to be manually re-applied on top of every change the state already made, by hand, forever, with the two versions drifting further apart every time.

**In practice:** A state's customization is a separate, targeted patch layered on top of an untouched base, combined by a build step into the final result — so upgrading the base later means re-applying that same layered patch, not manually redoing every edit by hand. The combined result gets checked exactly the same way the base is, so a customization can't quietly produce something broken that nobody notices until the system is live.

*Reference:* [JSON Merge Patch, RFC 7396](https://www.rfc-editor.org/rfc/rfc7396); [Kubernetes Kustomize overlays](https://kubectl.docs.kubernetes.io/references/kustomize/) (same technique, different domain).

### 6. Prefer open standards over bespoke formats

**Why:** A format only this blueprint uses has no existing tooling, no developers who already know it, and no guarantee it'll still be maintained in ten years — the same lock-in risk this blueprint protects states from with their runtime vendors, just applied one layer up, to the format the contracts themselves are written in. An open standard already has an ecosystem: validators, code generators, documentation tools, and people who've used it before, none of which this project would have to build or teach from scratch.

**In practice:** The API shape is OpenAPI, not a bespoke schema language. Events use CloudEvents and are documented with AsyncAPI, not a custom envelope. Resource schemas and validation rules are JSON Schema, which also means the same schema describing a resource's shape for the API can be referenced by that resource's state machine, instead of maintaining two separate descriptions of the same data. State customizations are JSON Merge Patch, an actual IETF standard, not a purpose-built diffing format. Where no established standard exists — expressing form conditions and decision rules, for example — the blueprint reaches for the most widely adopted general-purpose option (CEL) rather than inventing something from scratch.

*Reference:* [OpenAPI Specification](https://spec.openapis.org/oas/latest.html); [CloudEvents](https://cloudevents.io/); [AsyncAPI](https://www.asyncapi.com/); [JSON Schema](https://json-schema.org/); [CEL (Common Expression Language)](https://cel.dev/).

## Where to go deeper

For the specific software patterns used to realize these philosophies, see [Architecture Patterns](architecture-patterns.md).
