# Explorer

Visual and reference documentation generated from the blueprint contracts.

## Tools

| Tool | Description |
|---|---|
| **API Reference** | OpenAPI-derived endpoint docs with parameters, request/response schemas, and state machine links |
| **Client Reference** | TypeScript SDK reference — types and methods per domain |
| **State Machine Docs** | State machines with states, transitions, actions, and event subscriptions |
| **Event Catalog** | Cross-domain event index — every emitted event with its publisher and subscribers |
| **Data Dictionaries** | Field-level reference derived from the writable schemas |
| **Sequence Diagrams** | Key workflow sequences across domain boundaries |
| **Context Map** | Domain relationship diagram |

## Building

```bash
# Build everything (auto-resolves contracts if needed)
node build.js

# Build a single tool
node build.js --only=api-reference
node build.js --only=state-machine-docs
node build.js --only=event-catalog
node build.js --only=client-reference
node build.js --only=data-dictionaries
node build.js --only=sequence-diagrams
node build.js --only=context-map
```

## State customization

States running overlays can build the explorer from their own resolved specs:

```bash
node build.js \
  --resolved=/path/to/state/resolved \
  --clients=/path/to/state/clients
```

- `--resolved` — directory of resolved OpenAPI and state machine files (output of the resolve pipeline with overlays applied). When provided, auto-resolve is skipped.
- `--clients` — root clients directory containing `generated/` and `utility/` subdirectories.

The output is a set of static HTML files that can be published as a documentation site.
