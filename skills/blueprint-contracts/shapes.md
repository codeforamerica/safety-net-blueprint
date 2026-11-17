# From the sketch to an architecture

The scope is the blueprint's own architecture applied to what the developer described. The method is in the blueprint's docs; follow them rather than this summary, and read each one named here before recommending from it:

- [architecture-philosophy.md](reference/docs/architecture/architecture-philosophy.md): the reasons behind the design.
- [architecture-patterns.md](reference/docs/architecture/architecture-patterns.md): the named patterns that carry them out.
- [contract-driven-architecture.md](reference/docs/architecture/contract-driven-architecture.md): which contracts each kind of domain needs, and how they become requirements for an implementation.
- [inter-domain-communication.md](reference/docs/architecture/inter-domain-communication.md): how domains connect.
- [standards.yaml](reference/docs/conventions/standards.yaml): standards first, then prior art, and invent only when neither fits, saying so.
- [architecture-docs.yaml](reference/docs/conventions/architecture-docs.yaml): how a domain's design is written down, which the scope feeds.
- The pattern files in [patterns/](reference/INDEX.md#patterns-which-one-to-use-and-how): for each pattern, when to use it, when not to and what to use instead, and its rules. When one fits what the developer described, read it and follow it; its `use_when` and `do_not_use_when` are the reason you give.

Give the developer each pattern's name and its reason in plain words. Stay at the level of architecture: which domains, which kinds of contract, how they connect. How each contract is written is for building.

Sections marked **(the skill's own)** add something the blueprint doesn't say. Tell the developer when a recommendation rests on one.

## 1. Where each part sits (the skill's own)

The blueprint assumes the system belongs to the organization that runs it. This skill adds the question of where each part sits and who runs it, because it changes what's inside the system and what's outside. Parts can sit differently, and some may be undecided: then lay out what each option would mean and keep the design open to them, rather than choosing.

- **Part of one organization's system.** That organization's other systems are its neighbors: other domains, or outside systems behind adapters.
- **Used by other organizations.** It's the outside system from its customers' point of view:
  - Its API is what its customers' adapters call. Design it for them (Data as a Product, in architecture-patterns.md), and check whether the blueprint defines or plans an adapter contract for this kind of system ([adapters.md](reference/docs/architecture/cross-cutting/adapters.md), "Who defines the adapter contract"). If it does, match it.
  - Its customers are organizations, each with its own settings, data and users. Serving several from one running system is a gap ([coverage.md](coverage.md)).
  - Its customers' systems are research into what they'll expect, not a model for its domains.
  - Rules apply to whoever runs it as well as to its customers ([field-knowledge.md](field-knowledge.md)).
- **Run together by several organizations.** The same, plus who decides changes. The blueprint has no guidance on shared governance.
- **Possibly run, owned or replaced by customers.** Those parts need overlay points and a clear boundary, so a customer can host or change them without breaking the rest. Changing what the contracts say is an overlay ([overlay-customization.yaml](reference/docs/conventions/patterns/overlay-customization.yaml)); running a part somewhere else is routing ([routing.yaml](reference/docs/conventions/patterns/routing.yaml)).

## 2. Domains

Draw the boundaries as architecture-philosophy.md §2 (Domain-Driven Design) and architecture-patterns.md §2 say: bounded contexts that match how the work is organized, each owning its data and reached only through its published interface. Probe for them as [questions.md](questions.md) says.

- Start with the fewest domains the story calls for. Name the other domains each depends on, and whether the developer builds them, borrows them, or treats them as outside.
- A concern that applies across domains is cross-cutting, not a domain (architecture-docs.yaml, `cross_cutting`).
- Say when part of what the developer described could be its own domain, and why. Let them decide.

## 3. What each domain needs

**Shape first.** contract-driven-architecture.md ("Contract Artifacts") decides the core of each domain's contracts:

- **Data-shaped:** the value is in the data. It needs an API contract only.
- **Behavior-shaped:** the value is in what it enforces and decides. It needs a state machine; that's what makes it behavior-shaped. Metrics are added when it needs operational monitoring.
- **Any domain** may also need field metadata, when fields carry context that varies by program, role or group.
- A **free-form, collaborative process** doesn't fit a state machine; the doc recommends a simpler REST API instead ("Risks and Mitigations").

**Then what the story calls for.** Recommend a kind only when something the developer said calls for it, and give that as the reason. Where the last column names a pattern file, read it before recommending: its `use_when` and `do_not_use_when` decide, not this table. The first column, matching what the developer said to a need, is the skill's own.

| When the story has | It needs | Where the blueprint says when and how |
|---|---|---|
| Records others read and change | An API and its records | Contract-first design (architecture-patterns.md) |
| Stages, who may move them | A state machine | Statecharts (architecture-patterns.md) |
| A deadline or reminder: something happens when time passes | Timers | [timers.yaml](reference/docs/conventions/patterns/timers.yaml) |
| Decisions or calculations by rule, beyond a simple check | Rules | Rules engine (architecture-patterns.md) |
| One operation that runs a sequence, including calls to other domains, and needs their results | Steps declared in the state machine | Orchestration (architecture-patterns.md) |
| One domain needing another to act, to know something happened, or to read its data | A command, an event or a read | [cross-domain-communication.yaml](reference/docs/conventions/patterns/cross-domain-communication.yaml) |
| A result that comes back later and has to be matched to what asked for it | Context passed along and returned | [context-passthrough.yaml](reference/docs/conventions/patterns/context-passthrough.yaml) |
| Changes that must be traceable: who, when, what it was before | The audit domain, not each domain's own | [audit-trail.yaml](reference/docs/conventions/patterns/audit-trail.yaml) |
| A view built from several domains, like reports | A read view built from events, owned by whoever needs it | CQRS (architecture-patterns.md) |
| A client needing several related records together, or saving them together | A composition | [composition.yaml](reference/docs/conventions/patterns/composition.yaml) |
| Something from a system outside the blueprint | An adapter | [adapter.yaml](reference/docs/conventions/patterns/adapter.yaml) |
| A live stream between the browser and a vendor, such as audio | A browser-to-vendor stream | [browser-vendor-stream.yaml](reference/docs/conventions/patterns/browser-vendor-stream.yaml) |
| Judging what loose content means: what someone said, what a document shows | Analysis by a model | [analysis.yaml](reference/docs/conventions/patterns/analysis.yaml) |
| Requirements that differ by program, role or group | Field metadata | Contract-first design (architecture-patterns.md) |
| Something to measure | Metrics | Contract-first design (architecture-patterns.md) |
| Parts others might adapt, or being built on someone else's contracts | Overlay points, what must stay the same, and a plan for their updates | [overlay-customization.yaml](reference/docs/conventions/patterns/overlay-customization.yaml) |
| A case that takes several steps to see working | A scenario | Contract-first design (architecture-patterns.md) |

**Events: only real needs.** Decide which events a domain publishes from real integration needs, not every possible change (inter-domain-communication.md, "Domain events — scope"). Records announce their own creation, changes and deletion without anything extra; audit is built from those by a cross-cutting audit domain ([audit-trail.yaml](reference/docs/conventions/patterns/audit-trail.yaml)), not by each domain.

Then say what each domain **doesn't** need, so nobody adds it by default.

## 4. How the domains connect

For each connection, follow [cross-domain-communication.yaml](reference/docs/conventions/patterns/cross-domain-communication.yaml) and inter-domain-communication.md's decision rule ("Choosing a pattern"), and give the reason.

- **Command:** the caller needs a result to finish what it's doing.
- **Domain event:** a domain announces that its own state changed; others react on their own.
- **Async command:** a command starts something long-running, and an event delivers the result later. The doc's example is a call to an outside data source.
- **Cross-domain seeding:** one domain writes records into another, only when both of the doc's conditions hold: the writer is authoritative for that data, and it doesn't need a result.

## 5. What will implement it

contract-driven-architecture.md ("Contracts as requirements") says the contracts are requirements, met in one of three ways: a full workflow or rules engine configured to match, a simple backend whose code does what the contracts say, or a mix. Ask which is likely, or mark it open: it doesn't change the contracts, but it changes how much the developer's team builds, and the contracts become the checklist for choosing a vendor ("Development to production").

## 6. Standards and inventions

Name the standard behind each kind of contract, from standards.yaml. When something the developer needs has no standard or prior art, say so, mark it as invented, and say why, as standards.yaml's `order_of_preference` requires.

## 7. When a safety-net domain already models part of it (the skill's own)

The safety-net contracts have domains such as data exchange, intake, eligibility and case management. When part of what the developer described matches one, say so, and offer three choices with your recommendation:

- (A) Build their own, framework only. This is the default.
- (B) Follow the domain's design, from its doc, in their own contracts.
- (C) Build on the safety-net contracts.

Say that those contracts are still changing and some aren't finished, so (C) means taking on their changes. Check the domain's status in [coverage.md](coverage.md) before offering (C). The domain docs are in [reference/docs/architecture/domains/](reference/docs/architecture/domains/).
