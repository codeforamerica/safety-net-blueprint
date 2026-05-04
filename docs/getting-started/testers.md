# Getting Started: Testers

This guide is for QA engineers, integration testers, and anyone writing or running tests against the Safety Net Blueprint APIs.

See also: [Testing Guide](../guides/testing.md) | [Mock Server Guide](../guides/mock-server.md)

## What You'll Work With

- **Mock server** — an in-memory API server that serves all REST and RPC endpoints; no production backend needed
- **Postman collection** — auto-generated from specs; run manually or via Newman for full API coverage
- **Integration test suite** — exercises CRUD, state machine transitions, domain events, and rule evaluation end-to-end
- **Fixture data** — stable, namespaced test records with consistent cross-references between resources

## Prerequisites

- Node.js >= 20.19.0
- npm

## Initial Setup

```bash
git clone https://github.com/codeforamerica/safety-net-blueprint.git
cd safety-net-blueprint
npm install
```

## Running Tests

| Command | What it runs |
|---------|-------------|
| `npm test` | Unit tests — route generation, seeding, rules engine, state machine, relationships |
| `npm run test:integration` | Integration tests — starts mock with fixture data, runs HTTP tests + Newman/Postman |
| `npm run preflight` | Everything — validation, lint, unit tests, overlay resolution, Postman generation, integration tests |

Run `npm run test:integration` for the full end-to-end stack. It starts the mock server automatically, runs all tests, and shuts down when done.

## Testing Against the Mock Server

For exploratory or manual testing, start the mock server directly:

```bash
npm run mock:start
```

The mock server starts on `http://localhost:1080` and is pre-seeded with example data from `packages/contracts/*-openapi-examples.yaml`.

See the [Mock Server Guide](../guides/mock-server.md) for available endpoints, filtering, and state machine RPC operations.

## Fixture Data

The integration test suite uses dedicated fixture data — not the documentation examples. Fixture records use stable, namespaced UUIDs and have consistent FK cross-references (every foreign key points to a record that actually exists in the fixture set).

See the [Testing Guide](../guides/testing.md) for the full fixture ID namespace map, cross-reference table, and explanation of why fixtures are kept separate from documentation examples.

## Postman Collection

A Postman collection is generated automatically during integration tests. To generate and use it manually:

```bash
# Generate collection from base specs
npm run postman:generate

# Or generate from resolved specs (with overlay applied)
npm run resolve -- --spec=<spec-dir> --overlay=<overlay-dir> --out=<out-dir>
node packages/contracts/scripts/generate-postman.js --spec=packages/resolved
```

The generated collection covers all CRUD endpoints and RPC state machine operations. Import it into Postman or run it headlessly with Newman:

```bash
npx newman run packages/contracts/postman-collection.json --env-var baseUrl=http://localhost:1080
```

## Adding Tests

- **New unit test** — create a `*.test.js` file in `packages/mock-server/tests/unit/` or `packages/contracts/tests/unit/`
- **New integration test** — add to the appropriate section in `packages/mock-server/tests/integration/integration.test.js`
- **New fixture data** — add records to `packages/mock-server/tests/fixtures/examples/`; use the established ID namespace for the resource type

See the [Testing Guide](../guides/testing.md) for detailed instructions on each.

## Key References

| Document | What it covers |
|----------|---------------|
| [Testing Guide](../guides/testing.md) | Test levels, fixture data, fixture IDs, adding tests |
| [Mock Server Guide](../guides/mock-server.md) | Starting the mock, available endpoints, RPC operations |
| [Resolve Pipeline](../architecture/resolve-pipeline.md) | How overlays transform base specs into deployment artifacts |
