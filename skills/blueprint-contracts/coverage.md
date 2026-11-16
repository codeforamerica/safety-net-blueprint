# What the blueprint covers, and what it doesn't

At the scope level only: what the developer will have to build or decide outside the blueprint. Tell them about each gap their answers run into.

## What it covers

The contracts for a backend: its records and APIs, lifecycles, rules, events and connections to outside systems. Tools check them, run them as a working mock, and generate a client and docs. That's enough to agree on a design, hand it to developers, and walk through it with scenarios that run against the mock.

## Gaps

| Gap | What it means | Matters when |
|---|---|---|
| **No production backend.** The mock is for development, with fictional data. | The developer's team builds the real backend to match the contracts. | The goal is something to deploy |
| **No screens.** The blueprint is the backend's contracts. | The developer builds the UI on the generated client. | It's a product (people use it) |
| **Sign-in and security are still being designed.** The identity provider is the organization's own. How contracts declare who may do what is being reconsidered, so the current model isn't settled. | Put who may do what in the scope in plain words. Don't commit to a security design from the docs yet. | People use it, or private data |
| **Acting on someone else's behalf is planned, not built.** | Who acted, and for whom, has to be designed, including for audit. | Someone acts for someone else |
| **Outside systems are a contract, not a connection.** | Connecting to the real source is the developer's code; the demo uses stand-ins. | It gets information from outside systems |
| **Rules that change by date aren't supported yet.** Contracts carry no effective dates. | Policy amounts or rules that change on a date are handled outside the contracts for now. | Rules change by date |
| **Serving many customer organizations from one system isn't covered.** Overlays customize a copy for one organization when it's deployed; nothing covers keeping several customers' settings, data and users apart in one running system. The docs only mention a tenant identifier in sign-in claims. | The developer designs how customers are kept apart. | It's a product others use, or a shared service |
| **How organizations change their configuration while running isn't designed.** | Configuration can be set when deployed; an admin tool for changing it is the developer's. | The organization sets things up ahead of time |

## The safety-net domains' status

Before offering to build on one (choice C in [shapes.md](shapes.md)), check how finished it is: its doc can describe a design that isn't built yet. Read the domain's doc and its contracts, and say how far along it is before recommending it. For example, data exchange's design is complete and its API, configuration and events exist, but its lifecycle and mock data don't yet, so building on it means waiting on, or writing, those parts. [domain-design.md](reference/docs/architecture/domains/domain-design.md)'s status table is out of date.
