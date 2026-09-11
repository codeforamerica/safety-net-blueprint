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

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MOCK_SERVER_HOST` | `localhost` | Server bind address |
| `MOCK_SERVER_PORT` | `1080` | Server port |

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

## Changelog

See [CHANGELOG.md](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/blueprint-mock-server/CHANGELOG.md) for release history.

## Documentation

See the [Mock Server guide](https://github.com/codeforamerica/safety-net-blueprint/blob/main/docs/guides/mock-server.md) for full usage.

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
