# @codeforamerica/blueprint-mock-server

> Mock API server for contract-first development — auto-generates CRUD, RPC, and event endpoints from Blueprint contracts

[![npm version](https://img.shields.io/npm/v/@codeforamerica/blueprint-mock-server.svg)](https://www.npmjs.com/package/@codeforamerica/blueprint-mock-server)
[![license](https://img.shields.io/npm/l/@codeforamerica/blueprint-mock-server.svg)](https://github.com/codeforamerica/safety-net-blueprint/blob/main/LICENSE)

> **Pre-release:** This package is at `0.x`. Until `1.0.0`, minor versions may include breaking changes. Pin your version if stability matters.

> **Reference implementation.** One way to do this, not the only one: use it as is, adapt it, or replace it. The contracts are the authority; anything that satisfies them works the same. The mock is for development and demos, not production.

## Installation

```bash
npm install @codeforamerica/blueprint-mock-server
```

## What It Does

A mock API server that reads resolved OpenAPI specs and state machine definitions and stands up a fully functional API — no backend required. It runs on `node:http`, or as a `fetch` handler with no server at all, including in a browser. Frontend teams can develop and test against real API contracts from day one.

- **Auto-discovers specs** — generates all routes from `*-openapi.yaml` files at startup
- **Database per domain** — each domain gets its own in-memory database with full CRUD support
- **Seeding** — populates databases from example files; generates faker-based seed data when none exists
- **State machine enforcement** — validates RPC transitions against guard conditions, actor restrictions, and current state
- **Rules and compositions** — serves every ruleset's and composition's endpoint, at the path it declares
- **SLA enforcement** — tracks SLA clocks and fires timer events when deadlines are reached
- **Event streaming** — SSE endpoints emit domain events on state transitions
- **Event and HTTP stubbing** — simulate downstream responses for testing event-driven flows
- **Document upload** — accepts multipart uploads and records what it measured about each file; the bytes are never stored
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

`--spec` takes a directory of resolved contracts, or a single `contracts.json`
built by `blueprint-bundle-contracts`:

```bash
blueprint-mock --spec=./resolved          # walk a directory
blueprint-mock --spec=./contracts.json    # read one file
```

The second reads exactly the documents the artifact was built from rather than
whatever is on disk now, and it is the same file a browser boots from.

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

`./store` exports the in-memory store on its own, without a native module, so
it can be used in a browser or in a test that has no need of a server. `createSqliteStore` comes from the package root, since that is Node
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

## In a browser

The route table has no dependency on `node:http`, so the same handlers answer
in a page. Hand `createMockServer` a contracts artifact and it returns a
`fetch`:

```js
import { createMockServer } from '@codeforamerica/blueprint-mock-server/server';

const contracts = await (await fetch('./contracts.json')).json();
const mock = await createMockServer({ contracts });

const response = await mock.fetch(new Request('/intake/applications'));
```

`mock.fetch` has `fetch`'s own signature, so it can be called directly, handed
to a test runner, or assigned over `window.fetch`. `/browser` is an older name
for `/server`, and is deprecated.

### A client and a server

Some APIs run in the page rather than on the server, like a transcription
session, which follows one tab's connection. `createMockClient` runs those in
the page and sends everything else to the server. It takes the same options
as `createMockServer`; a routing entry for every domain (`domain: '*'`) names
the server, and its `except` names what the page keeps. It starts with no
seeded records, since what it keeps is the page's own.

```js
import { createMockClient } from '@codeforamerica/blueprint-mock-server/client';

const client = await createMockClient({
  contracts,
  routing: [{
    domain: '*',
    to: 'https://api.example.gov',
    except: [{ api: 'communication-transcription-sessions' }],
    includeHeaders: ['Authorization'],
  }],
});
```

`to` can be a `handler` instead, such as a mock server's `fetch`, to run both
in one page. A request for something the client's contracts don't have goes
to the server too, so a client bundled with only its own domains
(`blueprint-bundle-contracts --domain=…`) still reaches everything else.

`/client` and `/server` are the source, for a page that has a bundler. For one that doesn't,
use `dist/blueprint-mock-server.esm-browser.js`: one ES module with every
dependency inside and nothing else to install, exporting both
`createMockClient` and `createMockServer`. Copy it next to the page and
import it from there, or import it by that path from the package
(`@codeforamerica/blueprint-mock-server/dist/blueprint-mock-server.esm-browser.js`).
The licenses and notices of the third-party code inside it are at the end of
the file; keep them with it.

Assigning over `window.fetch` only reaches code that calls `fetch`. An SDK
generated with `generate-ts-clients --http-client=fetch` takes the mock's
`fetch` directly: `createClient({ baseUrl, fetch: mock.fetch })`. The default,
`@hey-api/client-axios`, uses `XMLHttpRequest` in a browser, so that swap
leaves every generated call going to the network. Hand the mock to axios
instead:

```js
import { createClient } from './clients/intake/client';
import { listApplications } from './clients/intake';

const client = createClient({
  baseURL: '/intake',
  adapter: 'fetch',
  env: { fetch: mock.fetch },
});

await listApplications({ client });
```

Both settings have to be there when the client is built: `createClient` hands
its config to `axios.create`, and setting them on an instance afterwards leaves
the default adapter in place.

| Option | Default | |
|---|---|---|
| `contracts` | — | Parsed output of `blueprint-bundle-contracts` |
| `store` | a fresh in-memory store | Any store implementation |
| `basePath` | `''` | A path prefix to strip before matching |
| `baseUrl` | `''` | Base for `Location` headers |
| `seed` | `true`; `false` for `createMockClient` | Seed from the artifact's mock-data documents |
| `routing` | `[]` | Domains, APIs and operations a real service or a `handler` answers — see [Routing](../../docs/guides/mock-server.md#routing-to-a-real-service) |

`basePath` matters when the page is not at the root of its origin. GitHub Pages
serves a project site from `/<repo>/`, so a request for `/intake/applications`
arrives as `/<repo>/mock/intake/applications`:

```js
createMockServer({ contracts, basePath: location.pathname.replace(/\/[^/]*$/, '') });
```

The prefix is stripped once, before matching, so handlers and HTTP stubs never
see it.

`blueprint-harness` builds a worked example of both — a served version and a
single self-contained file — in `packages/blueprint-harness/generated/mock/`.
The page it is built from is `packages/blueprint-harness/mock/index.html`.

## References are not dereferenced

The server resolves a `$ref` against the contract set when something needs to
see through one, rather than being handed pre-flattened specs. Inlining
multiplies every shared schema by the number of places referencing it — it is
the difference between a 0.67 MB artifact and a 3.95 MB one.

[REFERENCES.md](./REFERENCES.md) records why, how resolution works at each
layer, and the four bugs the change cost — all of which passed the test suites,
because the fixtures were dereferenced and so had no refs to resolve.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MOCK_SERVER_HOST` | `localhost` | Server bind address |
| `MOCK_SERVER_PORT` | `1080` | Server port |
| `MOCK_STORE` | `sqlite` | `sqlite` or `memory` — takes precedence over `--store` |

## Simulating Events

The mock server supports event stubs for testing event-driven behavior without a real event bus. A stub answers the next event of the type it names with the event it carries:

```
POST /mock/stubs/events
{ "on": "data-exchange.external_service_call.created", "response": { "type": "data-exchange.call.completed", "data": { "result": "conclusive" } } }
```

Stubs are checked against [`schemas/stubs-schema.json`](schemas/stubs-schema.json). See the [mock server guide](../../docs/guides/mock-server.md#event-stubs) for both kinds of stub.

## Programmatic Use

```js
import { startMockServer, stopServer } from '@codeforamerica/blueprint-mock-server/server';

await startMockServer(['./resolved'], './seed');
// ... run tests ...
await stopServer();
```

In Node, `/server` has both ways to run the server: `startMockServer`, over
HTTP from contract folders, and `createMockServer`, from an artifact through
`fetch`. A page that imports `/server` gets only `createMockServer`; the
package's export conditions keep the Node server out of a browser bundle.
The package's main entry still exports `startMockServer` too.

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
