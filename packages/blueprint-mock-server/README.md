# @codeforamerica/blueprint-mock-server

> Mock API server for contract-first development — auto-generates CRUD, RPC, and event endpoints from Blueprint contracts

[![npm version](https://img.shields.io/npm/v/@codeforamerica/blueprint-mock-server.svg)](https://www.npmjs.com/package/@codeforamerica/blueprint-mock-server)
[![license](https://img.shields.io/npm/l/@codeforamerica/blueprint-mock-server.svg)](https://github.com/codeforamerica/safety-net-blueprint/blob/main/LICENSE)

> **Pre-release:** This package is at `0.x`. Until `1.0.0`, minor versions may include breaking changes. Pin your version if stability matters.

## Installation

```bash
npm install @codeforamerica/blueprint-mock-server
```

## What It Does

An Express-based mock API server that reads resolved OpenAPI specs and state machine definitions and stands up a fully functional API — no backend required. Frontend teams can develop and test against real API contracts from day one.

- **Auto-discovers specs** — generates all routes from `*-openapi.yaml` files at startup
- **Database per domain** — each domain gets its own in-memory database with full CRUD support
- **Seeding** — populates databases from example files; generates faker-based seed data when none exists
- **State machine enforcement** — validates RPC transitions against guard conditions, actor restrictions, and current state
- **SLA enforcement** — tracks SLA clocks and fires timer events when deadlines are reached
- **Event streaming** — SSE endpoints emit domain events on state transitions
- **Event and HTTP stubbing** — simulate downstream responses for testing event-driven flows
- **Document upload** — handles file uploads and serves documents back at runtime
- **Metrics endpoints** — computes and serves metrics from live database records
- **Search and filtering** — full-text search, filtering, sorting, and pagination on all list endpoints
- **Swagger UI** — browse and test all endpoints interactively at `http://localhost:3000`

See the [Mock Server guide](https://github.com/codeforamerica/safety-net-blueprint/blob/main/docs/guides/mock-server.md) for full usage.

## Commands

```json
"scripts": {
  "mock": "blueprint-mock --spec=./resolved",
  "swagger": "blueprint-swagger --spec=./resolved"
}
```

| Command | Port | Description |
|---------|------|-------------|
| `blueprint-mock` | 1080 | Mock API server |
| `blueprint-swagger` | 3000 | Swagger UI |

## Seeding

Place `*-mock-data.yaml` files alongside your resolved specs. The server loads them on startup and on `POST /mock/reset`.

```yaml
# intake-mock-data.yaml
applications:
  - id: app-001
    status: draft
    programsAppliedFor: [snap]
```

## Stores

Resources are held in a store, chosen at startup.

```bash
npm run mock:start -- --spec=<dir>                   # sqlite (default)
npm run mock:start -- --spec=<dir> --store=memory    # in memory
MOCK_STORE=memory npm test                           # for a test run
```

**`sqlite`** keeps one `.db` file per collection under `generated/mock-data/`, so
data survives a restart and can be inspected with the `sqlite3` CLI. It is the
default, so nothing about running the server by hand has changed.

**`memory`** holds everything in Maps. Faster — measurably so on writes — leaves
nothing on disk, and loads no native module, which is also a way past a
`better-sqlite3` build failure. Nothing survives the process.

In practice the two are hard to tell apart, because the server clears and
reseeds every collection at startup either way: SQLite's durability is never
actually relied upon.

### Using a store directly

```js
import { createMemoryStore } from '@codeforamerica/blueprint-mock-server/store';

const store = createMemoryStore();
store.insertResource('applications', { id: 'app-001', status: 'draft' });
store.findAll('applications', { status: 'draft' });
```

`./store` exports the in-memory store on its own, without pulling in Express or
a native module, so it can be used in a browser or in a test that has no need of
a server. `createSqliteStore` comes from the package root, since that is Node
only regardless.

Every method is synchronous. Both implementations are natively synchronous —
`better-sqlite3` is a synchronous binding and the other is Maps — so promises
would buy nothing and would make every handler async.

### Writing another store

`src/stores/contract.js` documents the thirteen methods and, more usefully, the
three behaviours that are easy to get wrong because they fall out of SQLite's
storage model rather than from the method names: reads return copies rather than
references, ordering is `createdAt` descending rather than insertion order, and a
`null` filter matches a missing field as well as an explicit null.

`tests/unit/store-conformance.test.js` is the executable version — it runs every
case against both implementations, and a new store is correct when it passes.
That suite found three real defects on the day it was written, so it is worth
running against anything new rather than reading the contract and trusting it.

## Routing

Every endpoint is a function from a `Request` to a `Response` — the same
signature as `fetch` — held in a table keyed by method and path:

```
'GET /intake/applications/{applicationId}'  →  { operationId, handler }
```

So making an endpoint real is assigning a different function to `entry.handler`,
with no adapter, and anything that can hand the table a `Request` can serve it:
a Node server, a service worker, or a direct call in a test.

[ROUTING.md](./ROUTING.md) covers the resolution rules and why the matcher is
~40 lines rather than a dependency.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MOCK_SERVER_HOST` | `localhost` | Server bind address |
| `MOCK_SERVER_PORT` | `1080` | Server port |
| `MOCK_STORE` | `sqlite` | `sqlite` or `memory` — takes precedence over `--store` |

## Simulating Events

The mock server supports event stubs for testing event-driven behavior without a real event bus. Stub an event and it will fire on the next matching subscription trigger:

```
POST /mock/stubs/events
{ "name": "scheduler.timer.fired", "data": { "subject": "task-123", "timerType": "creation_deadline" } }
```

## Programmatic Use

```js
import { startMockServer, stopServer } from '@codeforamerica/blueprint-mock-server';

await startMockServer(['./resolved'], './seed');
// ... run tests ...
await stopServer();
```

### Writing tests against the server

`@codeforamerica/blueprint-mock-server/test-utils` provides the helpers the
blueprint's own integration tests use — a `fetch` wrapper that points at the
running server and sets auth headers, plus event injection and stub control.

```js
import { fetch, caller, injectEvent, clearStubs } from '@codeforamerica/blueprint-mock-server/test-utils';

const res = await fetch('/applications', { caller: caller('user-1', ['caseworker']) });
await injectEvent('application.submitted', { applicationId: 'app-1' });
await clearStubs();
```

## Changelog

See [CHANGELOG.md](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/blueprint-mock-server/CHANGELOG.md) for release history.

## Documentation

See the [Mock Server guide](https://github.com/codeforamerica/safety-net-blueprint/blob/main/docs/guides/mock-server.md) for full usage.

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
