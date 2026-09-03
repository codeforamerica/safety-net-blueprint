# Getting Started: Building a New Domain

> **Status: Draft**

This guide is for developers who want to define a new contract-driven API domain — whether that's adding a domain to a safety net system, extending an existing domain, or building something new in the same space. It walks through standing up a domain from scratch using the blueprint framework tools: scaffolding a spec, validating it, and running a mock server that generates live endpoints directly from your contracts.

See also: [Contract-Driven Architecture](../architecture/contract-driven-architecture.md) | [Creating APIs](../guides/creating-apis.md) | [Overlay Guide](../guides/overlay-guide.md)

## What the Framework Gives You

| Package | What it provides |
|---------|-----------------|
| `@codeforamerica/blueprint-core` | Overlay resolution, OpenAPI validation, state machine engine, annotations, compositions |
| `@codeforamerica/blueprint-cli` | CLI scripts: scaffold APIs, validate specs, resolve overlays, generate clients |
| `@codeforamerica/blueprint-mock-server` | Mock API server that auto-generates CRUD endpoints from OpenAPI specs and RPC endpoints from state machine YAML |

The framework is domain-agnostic. It doesn't know or care what your domain is — you bring the contracts, it provides the tooling.

## Prerequisites

- Node.js >= 20.19.0
- Git
- Familiarity with OpenAPI

## Setup

Install the framework packages into your project:

```bash
npm install @codeforamerica/blueprint-core \
            @codeforamerica/blueprint-cli \
            @codeforamerica/blueprint-mock-server
```

## Suggested Project Structure

A suggested layout as you add domains:

```
my-project/
├── package.json
└── src/
    ├── domains/
    │   └── {domain}/
    │       ├── {domain}-openapi.yaml         # REST API spec (required)
    │       ├── {domain}-schema.yaml          # Domain entity schemas
    │       ├── {domain}-mock-data.yaml       # Seed data for the mock server
    │       ├── {domain}-state-machine.yaml   # Lifecycle and RPC operations (optional)
    │       ├── {domain}-annotations.yaml     # Field-level metadata (optional)
    │       └── {domain}-compositions.yaml    # Composite resources (optional)
    └── common/
        ├── components/                       # Shared OpenAPI components (parameters, responses, etc.)
        └── schemas/                          # Shared JSON Schema files reused across domains
```

The `{domain}-` file naming convention is a suggestion — most tools support specifying artifact types directly, so you can name files however fits your project. Not every domain needs every artifact type; add files as the domain requires them.

`common/components/` is for OpenAPI-specific shared components. `common/schemas/` is for JSON Schema definitions — domain entity types and any shared schemas referenced by non-OpenAPI artifacts (state machines, annotations, compositions).

## Your First REST API

### 1. Scaffold the spec

```bash
npx blueprint-scaffold-api --name "permits" --domain "permits" --resource "Permit" --out ./src/domains/permits
```

This generates `permits-openapi.yaml` with full CRUD paths and schema variants (`Permit`, `PermitCreate`, `PermitUpdate`, `PermitList`). `--name` is the spec file name; `--domain` sets the `x-domain` field in the spec and defaults to `--name` if omitted.

The convention is to put all resources for a domain into a single spec file. You can split across multiple files if needed, as long as each spec declares its domain via `x-domain` in the `info` block.

### 2. Define your schemas

The scaffolded spec gives you the endpoint and schema structure, but not the domain fields — those are yours to define. Define domain entity schemas in JSON Schema for anything used by non-OpenAPI artifacts (state machines, annotations, compositions); OpenAPI specs can then reference those rather than redefine them. See [Creating APIs — Where to define the writable base](../guides/creating-apis.md#where-to-define-the-writable-base) for the recommended pattern.

### 3. Add more resources (optional)

To add a resource to an existing domain spec rather than creating a new one:

```bash
npx blueprint-add-api-resource --name "permits" --resource "Inspection" --out ./src/domains/permits
```

This merges new paths, schemas, and an example into the existing spec.

## Adding a Behavior Layer (optional)

If your domain involves stateful objects — things with a lifecycle that transitions through defined states — add a state machine YAML alongside your OpenAPI spec.

During resolve, RPC endpoints are generated from the state machine and merged into the resolved OpenAPI spec — `POST /permits/{permitId}/submit`, `POST /permits/{permitId}/approve`, etc. The mock server enforces valid state transitions and rejects invalid ones. No additional code needed.

See [Contract-Driven Architecture — State Machine](../architecture/contract-driven-architecture.md#state-machine) for the format and examples.

## Enriching Your Domain (optional)

### Annotations

Annotations attach field-level metadata to your schemas — any additional data you want to associate with a field and serve from the backend rather than hardcode in consumers. Examples: policy guidance, regulatory citations, verification requirements, contextual help text.

Annotations can be defined across one or more YAML files. Consumers retrieve and render whatever annotation types they find — annotations are exposed via generated TypeScript clients (see [Generating TypeScript Clients](#generating-typescript-clients) below).

See [Contract Metadata](../architecture/cross-cutting/contract-metadata.md) for how annotations are structured and linked to fields.

### Compositions

Compositions define composite resources that aggregate data from multiple APIs into a single response — useful when a consumer needs a unified view of records that live in separate domains. Compositions are defined declaratively and resolved by blueprint-core.

See [Resource Composition](../architecture/cross-cutting/resource-composition.md) for the format and examples.

## Overlays (optional)

Overlays are YAML files that apply targeted patches to your specs without modifying the source files. They're useful in two situations:

### Project-level configuration

A project-level `config.yaml` overlay sets defaults that apply across all your domains — casing conventions, pagination behavior, base ref resolution, relationship styles. Create an `overlays/config.yaml` alongside your `src/` directory and point `blueprint-resolve` at it:

```bash
npx blueprint-resolve --spec ./src --overlay ./overlays/config.yaml --out ./resolved
```

See [Overlay Guide](../guides/overlay-guide.md) for the available config options.

### Customizing an existing domain

If you want to take an existing domain — say, document management — and adapt it for a different pattern or purpose, overlays let you patch the base spec without forking it. Overlays use the [OpenAPI Overlay Specification](https://github.com/OAI/Overlay-Specification) format with JSONPath targeting: modify a schema field, add states to a state machine, adjust a transition's guard, or remove endpoints that don't apply to your context.

Your base spec stays clean; the overlay captures only your customizations.

See [Overlay Guide](../guides/overlay-guide.md) for syntax and examples.

## Resolving

Once your contracts are in place, resolve them to produce the output the mock server, validators, and client generator run against:

```bash
npx blueprint-resolve --spec ./src --overlay ./overlays/config.yaml --out ./resolved
```

Then validate the resolved output:

```bash
npx blueprint-validate --resolved ./resolved
```

## Generating Clients and Collections

From your resolved specs, you can generate a typed TypeScript SDK and a Postman collection:

```bash
npx blueprint-generate-ts-clients --spec ./resolved --out ./clients
npx blueprint-generate-postman-collection --spec ./resolved --out ./postman
```

The TypeScript clients include typed access to annotations. See [API Clients](../guides/api-clients.md) for how to use them.

## Running the Mock Server

```bash
npx blueprint-mock --spec ./resolved
```

The mock auto-discovers all `*-openapi.yaml` files in the resolved directory and creates live CRUD endpoints backed by an in-memory SQLite database. RPC endpoints from state machines are included in the resolved specs and served automatically.

To browse the API interactively, run the Swagger UI alongside the mock:

```bash
npx blueprint-swagger --spec ./resolved
```

Visit `http://localhost:3000` for interactive API docs.

## Key Commands

| Command | What it does |
|---------|-------------|
| `blueprint-scaffold-api` | Generate a new OpenAPI spec with CRUD paths and schema variants |
| `blueprint-add-api-resource` | Add a resource to an existing domain spec |
| `blueprint-validate` | Validate specs: syntax, lint, patterns, cross-artifact consistency |
| `blueprint-resolve` | Merge overlays against base specs, generate RPC endpoints from state machines |
| `blueprint-generate-ts-clients` | Generate typed TypeScript clients from resolved specs |
| `blueprint-generate-postman-collection` | Generate a Postman collection |
| `blueprint-mock` | Start the mock server (auto-discovers `*-openapi.yaml`) |
| `blueprint-swagger` | Start Swagger UI at http://localhost:3000 |

## Next Steps

- [Creating APIs](../guides/creating-apis.md) — Naming conventions, schema patterns, validation rules
- [Contract-Driven Architecture](../architecture/contract-driven-architecture.md) — The full conceptual picture: REST vs. RPC, behavioral contracts, the adapter pattern
- [Overlay Guide](../guides/overlay-guide.md) — Overlay syntax, JSONPath targeting, and the resolve pipeline
- [Mock Server](../guides/mock-server.md) — Seeding data, querying the mock, testing event-driven behavior
- [Explorer](../../packages/blueprint-explorer/README.md) — Generate a static reference site (API docs, state machine diagrams, event catalog) from your resolved specs and clients
