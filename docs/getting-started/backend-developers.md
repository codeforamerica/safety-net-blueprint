# Getting Started: Backend Developers

> **Status: Draft**

This guide is for developers who work with the contract artifacts — OpenAPI specs, state machines, rules, metrics, and form definitions — and build production adapters that satisfy those contracts.

See also: [Contract-Driven Architecture](../architecture/contract-driven-architecture.md) | [Domain Design](../architecture/domain-design.md)

> **Note:** OpenAPI specs, validation, overlays, and the mock server for CRUD operations work today. The behavioral contract tooling described below — conversion scripts, behavioral contract validation, and the mock server's state machine engine — is being built as part of the [steel thread prototypes](../prototypes/workflow-prototype.md). This guide describes the target developer experience.

## What You'll Do

- [**Author contract artifacts**](#1-author-in-tables) — work with tables (spreadsheets) that define state transitions, decision rules, metrics, and form definitions
- [**Run conversion scripts**](#2-generate-yaml) — generate YAML from authored tables (state machine, rules, metrics, form definition)
- [**Validate contracts**](#3-validate) — check cross-artifact consistency (states match OpenAPI enums, effect targets reference real schemas, field source paths resolve)
- [**Test against the mock server**](#4-test-with-the-mock-server) — the mock server serves both REST and RPC APIs, interpreting behavioral contracts directly and auto-generating RPC endpoints from state machine triggers
- [**Build production adapters**](#building-a-production-adapter) — implement the adapter that translates between contracts and your vendor systems
- [**Add state-specific variations**](#5-add-state-specific-variations) — customize contracts via overlays without forking the base files

## Prerequisites

- Node.js >= 20.19.0
- Git
- Familiarity with OpenAPI/Swagger

## Initial Setup

The toolkit provides base specs, scripts, and a mock server as npm packages. States create their own repository and install the base packages:

```bash
mkdir my-state-apis && cd my-state-apis
npm init -y
npm install @safety-net/contracts @safety-net/mock-server @safety-net/clients
```

See the [State Setup Guide](../guides/state-setup-guide.md) for the full setup process, including overlays, resolved specs, and CI pipeline configuration.

For development within this repository:

```bash
git clone https://github.com/codeforamerica/safety-net-blueprint.git
cd safety-net-blueprint
npm install

# Set your state (or add to your shell profile)
export STATE=<your-state>

# Verify installation
npm run validate
```

## What the Packages Provide

| Package | Description | CLIs |
|---------|-------------|------|
| `@safety-net/contracts` | Base OpenAPI specs, overlay resolver, validation | `safety-net-resolve`, `safety-net-design-reference` |
| `@safety-net/mock-server` | Mock API server and Swagger UI for development | `safety-net-mock`, `safety-net-swagger` |
| `@safety-net/clients` | Postman collection and TypeScript client generation | — |

States install these packages, apply overlays to customize for state-specific needs, and point the CLIs at their resolved specs.

## Contract Artifacts

Every domain needs contracts. What contracts you need depends on whether the domain is data-shaped or behavior-shaped.

| Artifact | When needed | What it defines |
|----------|------------|-----------------|
| **OpenAPI spec** | Every domain | Resource schemas, REST endpoints, query parameters |
| **State machine YAML** | Behavior-shaped domains | States, transitions, guards, effects, SLA behavior, audit requirements |
| **Rules YAML** | Domains with condition-based decisions | Routing, assignment, priority, escalation rules as decision tables |
| **Metrics YAML** | Domains needing operational monitoring | Metric names, source linkage to states/transitions, targets |
| **Form definition YAML** | Domains with context-dependent forms | Sections, field visibility, annotations, program requirements |

Data-shaped domains (persons, documents) need only an OpenAPI spec. Behavior-shaped domains (workflow, application review) need richer contracts. See [Contract-Driven Architecture](../architecture/contract-driven-architecture.md#contract-artifacts) for the full breakdown.

## Authoring Workflow

Contract artifacts are generated from tables — nobody edits YAML by hand. Business users and developers author in spreadsheets, and conversion scripts generate the YAML.

### 1. Author in Tables

Each concern gets its own table (sheet in a spreadsheet):

- **State transitions** — From State, To State, Trigger, Who, Guard, Effects
- **Guards** — Guard name, Field, Operator, Value
- **Effects** — Trigger, effect details (set, create, lookup, evaluate-rules, event)
- **Decision rules** — Conditions and actions for routing, assignment, priority
- **Metrics** — Metric name, source type, source linkage, target
- **Form definitions** — Program requirements, section definitions, field definitions with annotations

See the [Workflow Prototype](../prototypes/workflow-prototype.md) for complete examples of state transition, guard, effect, and decision tables. See the [Application Review Prototype](../prototypes/application-review-prototype.md) for form definition tables.

### 2. Generate YAML

Conversion scripts generate contract YAML from the authored tables. This tooling is being built as part of the prototypes — the commands below describe the target workflow:

```bash
# Generate all contract artifacts from tables (planned)
npm run contracts:generate

# Generate a specific domain (planned)
npm run contracts:generate -- --domain workflow
```

### 3. Validate

Today, `npm run validate` checks OpenAPI spec syntax and pattern compliance. The prototypes will extend validation to check cross-artifact consistency:

```bash
# Validate OpenAPI specs (works today)
npm run validate

# What validation will also catch (planned):
# - State machine states don't match OpenAPI status enums
# - Effect targets reference schemas that don't exist
# - Rule context variables don't resolve to real fields
# - Form definition field source paths don't resolve to OpenAPI schema fields
# - Transitions missing required audit effects
# - Metric sources reference states/transitions that don't exist
```

### 4. Test with the Mock Server

Today the mock server serves REST APIs (CRUD endpoints from OpenAPI specs). The prototypes will add a behavioral engine that interprets state machine YAML directly — auto-generating RPC endpoints from triggers, enforcing transitions, evaluating guards, executing effects, and tracking metrics.

```bash
# Within this repository
STATE=<your-state> npm start

# Or in a state repository with resolved specs
npm run mock:start
```

- **Swagger UI:** http://localhost:3000 — browse endpoints
- **Mock server:** http://localhost:1080 — API endpoints with in-memory database

The target: adding a transition is a table row, not endpoint code.

### 5. Add State-Specific Variations

States customize contracts via overlays without forking the base files. Overlays use the [OpenAPI Overlay Specification](https://github.com/OAI/Overlay-Specification) format with JSONPath targeting:

```bash
# Within this repository
STATE=<your-state> npm run overlay:resolve

# Or in a state repository
npm run resolve
```

If you're working in the base repository rather than a state repository, you can use the example overlay (`packages/contracts/overlays/example/`) to test overlay behavior without setting up a full state configuration.

See [State Overlays Guide](../guides/state-overlays.md) for overlay syntax and the [State Setup Guide](../guides/state-setup-guide.md) for the full state repository setup.

## Building a Production Adapter

The production adapter translates between the contract's API surface and your vendor systems. The contracts tell you exactly what the adapter must do.

**For REST APIs**, the adapter wraps a vendor's data store with a standard interface defined by the OpenAPI spec.

**For RPC APIs**, the adapter wraps a vendor system (workflow engine, rules engine) and exposes behavioral operations. How the adapter and vendor divide the work depends on the vendor:

- **Full workflow engine** (Camunda, Temporal) — The vendor handles state transitions, guards, effects natively. The adapter translates between the contract's HTTP surface and the vendor's APIs.
- **Simple backend** (database + application code) — The adapter orchestrates the behavior itself: enforcing transitions, evaluating guards, running effects.
- **Hybrid** — The vendor handles some concerns; the adapter orchestrates others.

The integration test suite (auto-generated from contracts) runs against both the mock server and your production adapter, verifying the same outcomes.

See [Contract-Driven Architecture — From Contracts to Implementation](../architecture/contract-driven-architecture.md#from-contracts-to-implementation) for the full adapter pattern and development-to-production transition.

## Key Commands

Commands within this repository (uses `STATE` environment variable):

| Command | When to Use |
|---------|-------------|
| `npm run validate` | After editing specs or generating contracts |
| `npm run overlay:resolve` | After editing overlays (with STATE set) |
| `npm run mock:reset` | After editing example data |
| `npm start` | To test contracts interactively (mock server + Swagger UI) |
| `npm run api:new` | To scaffold a new API |

See the [State Setup Guide](../guides/state-setup-guide.md) for equivalent commands in a state repository.

## Next Steps

- [State Setup Guide](../guides/state-setup-guide.md) — Setting up a state repository with overlays, CI, and resolved specs
- [Contract-Driven Architecture](../architecture/contract-driven-architecture.md) — How contracts define the API surface and enable portability
- [Workflow Prototype](../prototypes/workflow-prototype.md) — Complete example of behavioral contracts (state machine, rules, metrics)
- [Application Review Prototype](../prototypes/application-review-prototype.md) — Complete example of form definitions
- [State Overlays](../guides/state-overlays.md) — How state variations work
- [Creating APIs](../guides/creating-apis.md) — Designing new API specifications
