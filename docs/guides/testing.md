# Testing Guide

## Overview

The blueprint has three levels of testing:

| Level | Command | What it tests |
|-------|---------|---------------|
| Unit | `npm test` | Individual modules (route generator, seeder, rules engine, etc.) |
| Functional | `npm run test:functional` | Specific server behaviors against fixture specs + generated clients |
| Integration | `npm run test:integration` | Full mock server + HTTP + Postman/Newman against resolved contracts |
| Preflight | `npm run preflight` | All of the above plus validation, linting, and overlay freshness |

## Unit Tests

Unit tests live in `packages/mock-server/tests/unit/` and `packages/contracts/tests/unit/`. They use a lightweight custom test runner (no external framework) and run in isolation without a running server.

```bash
npm test            # Run all unit tests across all packages
npm run test:unit   # Run mock-server unit tests only
```

Unit tests cover:
- Route generation logic
- Database seeding from examples
- Search/query parsing
- State machine transitions and guard evaluation
- Rule evaluation
- Relationship resolution (expand, links-only)
- Overlay resolution

## Integration Tests

Integration tests (`packages/mock-server/tests/integration/integration.test.js`) start the mock server, make HTTP requests, and assert on responses.

```bash
npm run test:integration
```

### How integration tests work

The integration test suite runs the mock server against `packages/resolved` (the resolved contracts with overlay applied):

1. The mock server is started against `packages/resolved` with seed data from `packages/mock-server/seed/`
2. Tests make HTTP requests and assert on responses — CRUD, state machine RPC, domain events, rule evaluation
3. A Postman collection is run via Newman for additional coverage
4. Server is stopped after all tests complete

### Why fixture data?

Documentation examples (in `packages/contracts/*-openapi-examples.yaml`) serve as API documentation and realistic data for the mock. They may evolve as documentation improves.

Fixture data is owned by the test suite and only changes when test requirements change. This makes tests stable and independent from documentation changes. It also enables clean, verifiable cross-references — FK fields in fixture records point to records that actually exist in the same fixture set.

### Fixture ID namespacing

Fixture IDs use a domain-namespaced UUID format to avoid collisions:

| Resource | ID prefix |
|----------|-----------|
| Persons | `00000001-0000-4000-8000-...` |
| Users | `00000002-0000-4000-8000-...` |
| Households | `00000003-0000-4000-8000-...` |
| Applications | `00000004-0000-4000-8000-...` |
| Cases | `00000005-0000-4000-8000-...` |
| Incomes | `00000006-0000-4000-8000-...` |
| Appointments | `00000007-0000-4000-8000-...` |
| Queues | `00000008-0000-4000-8000-...` |
| Tasks | `00000009-0000-4000-8000-...` |
| Events | `0000000a-0000-4000-8000-...` |

### Fixture cross-references

Fixture FK fields reference other fixture records that actually exist:

- Cases reference PersonExample1/2/3 via `primaryApplicantId`
- Cases reference UserExample1 via `assignedToId`
- Tasks reference QueueExample1/2 via `queueId`
- Tasks reference UserExample1/2 via `assignedToId`
- Tasks reference subject entities via `subjectId` (type identified by `subjectType`)
- Appointments reference PersonExample1/2/3 via `personId`
- Appointments reference UserExample1/2 via `assignedToId`
- Incomes reference PersonExample1/2/3 via `personId`

### Required fixture data for behavioral tests

Rule evaluation tests require queues with specific names to be seeded:
- `snap-intake` (ID: `00000008-0000-4000-8000-000000000001`)
- `general-intake` (ID: `00000008-0000-4000-8000-000000000002`)

Postman RPC tests require a task with `status: pending` (the state machine's `initialState`) so the test can run the full `claim → complete → release` sequence. `TaskExample3` serves this purpose.

### Fixture files

Seed data files are in `packages/mock-server/tests/integration/seed/`. The key names in each file match the key names in the corresponding docs example file — this ensures that `$ref` pointers in the spec files (e.g., `"$ref": "./persons-openapi-examples.yaml#/PersonExample1"`) remain valid during fixture dir validation.

## Postman/Newman Tests

The integration test automatically generates a Postman collection from the fixture directory and runs it with Newman. The collection is written to a temp file and discarded after the run.

This ensures the collection always matches the specs and examples that the mock is serving — eliminating the alignment mismatch that occurs when the collection is generated from overlay-resolved specs but the mock serves base specs.

To manually run Postman tests against a running mock:

```bash
# Start the mock with fixture data:
npm run test:integration
# (or manually start mock and generate collection)

# Generate collection from base specs:
npm run postman:generate

# Or generate from resolved specs (with overlay):
node packages/contracts/scripts/resolve.js --spec=packages/contracts --overlay=packages/contracts/overlays --out=packages/resolved
node packages/contracts/scripts/generate-postman.js --spec=packages/resolved
```

## Preflight Checks

Before creating a PR, always run:

```bash
npm run preflight
```

This runs: validation, pattern checks, unit tests, overlay resolution, Postman generation, design reference freshness, and integration tests in sequence. All checks must pass.

## Adding New Tests

### New unit test

Create a file in `packages/mock-server/tests/unit/` or `packages/contracts/tests/unit/`. The custom runner auto-discovers `*.test.js` files.

### New integration test case

Add to the appropriate section in `packages/mock-server/tests/integration/integration.test.js`.

If the test requires new seed data, add records to `packages/mock-server/tests/integration/seed/`. Use the established ID namespace for the resource type.

### New API (integration test coverage)

CRUD tests are auto-discovered from `loadAllSpecs`, so adding a new API spec automatically adds CRUD tests. Ensure the new API has at least one fixture example with a valid `id`, `createdAt`, and `updatedAt`.
