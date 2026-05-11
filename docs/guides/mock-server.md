# Mock Server

Development mock server that serves REST APIs from OpenAPI specs and interprets behavioral contracts (state machines, rules, metrics) to serve RPC APIs.

## Quick Start

```bash
npm run mock:start    # Start server (port 1080)
```

Test it:
```bash
curl http://localhost:1080/health
# → { "status": "ok", "apis": ["intake", "workflow", ...] }
```

## How It Works

The mock server reads the contract files from `packages/contracts/` by default (or the resolved output folder when running with overlay specs) at startup and dynamically generates everything from them — there is no hand-written endpoint code.

**From OpenAPI specs** (`*-openapi.yaml`): generates standard CRUD endpoints (list, get, create, update, delete) for every resource, validates requests against schemas, and serves error responses in the shared error shape.

**From state machine files** (`*-state-machine.yaml`): generates RPC endpoints for every operation (e.g., `POST /workflow/tasks/:id/claim`), enforces valid state transitions (409 on invalid), evaluates guards, executes the steps declared in `then:` blocks, tracks SLA clocks, and fires domain events.

**From metrics files** (`*-metrics.yaml`): generates `GET /{domain}/metrics` and `GET /{domain}/metrics/{id}` endpoints that compute aggregates on-the-fly from live data.

Adding a new operation or resource requires only a contract change — no server code.

## Seed Data

The mock server seeds its database from pre-committed example files at startup. Seed files live in `packages/mock-server/seed/` — one YAML file per API (e.g., `intake.yaml`, `workflow.yaml`). Each file is a flat map of named examples:

```yaml
# packages/mock-server/seed/workflow.yaml
TaskExample1:
  id: task-001
  status: pending
  taskType: application_review
  subjectId: app-001
QueueExample1:
  id: queue-001
  name: snap-intake
```

The key prefix (e.g., `Task`, `Queue`) tells the server which collection each record belongs to. The server uses file-based SQLite stored at `packages/generated/mock-data/`.

If you change schemas significantly, regenerate the seed files:
```bash
npm run mock:seed
```

Resources referenced in state machine rules (queues, for example) must be present in the seed data for rule evaluation to work correctly.

## Mock Rules

Mock rules are YAML files in `packages/mock-server/mock-rules/` that teach the server how to respond to events from external domains — simulating the behavior of adapters or other services that aren't running locally.

A mock rule subscribes to a domain event and either fires a canned response event or delegates to the stub registry (see below). This lets you test full cross-domain flows without running real adapters.

See [`packages/mock-server/mock-rules/README.md`](../../packages/mock-server/mock-rules/README.md) for syntax and examples.

## Generated Endpoints

### REST endpoints

For each spec (e.g., `persons.yaml`):

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/persons` | List with pagination & search |
| GET | `/persons/{id}` | Get by ID |
| POST | `/persons` | Create |
| PATCH | `/persons/{id}` | Update |
| DELETE | `/persons/{id}` | Delete |

### RPC endpoints

For behavior-shaped domains, RPC endpoints are generated from state machine operations:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/workflow/tasks/:id/claim` | Trigger a state transition with guard enforcement |
| POST | `/workflow/tasks/:id/complete` | Trigger a state transition with effects |

A 409 response means the transition is invalid from the current state or a guard condition failed.

## Metrics Endpoints

The mock server computes metrics on-the-fly from live data. Metrics are defined in `*-metrics.yaml` files.

```bash
# List all metrics
curl "http://localhost:1080/workflow/metrics"

# Get a specific metric
curl "http://localhost:1080/workflow/metrics/task_time_to_claim"

# Filter and group
curl "http://localhost:1080/workflow/metrics?groupBy=queueId"
```

### Query Parameters

| Parameter | Description |
|-----------|-------------|
| `q` | Filter by metric name |
| `groupBy` | Break down metric values by a field (e.g., `queueId`, `program`) |
| `from` | Start of time window (ISO datetime) |
| `to` | End of time window (ISO datetime) |
| `queueId` | Filter source data to a specific queue |
| `program` | Filter source data to a specific program |

When `groupBy` is provided, the response includes a `breakdown` object mapping group values to per-group metric values.

## Timer Stubs

Timer stubs simulate the passage of time for testing `onTimer` triggers — state machine rules that fire after a duration has elapsed (e.g., auto-escalate a task after 72 hours, auto-cancel after 30 days).

**How it works:** Register a timer stub declaring what time the server should treat as "now." Call `POST /mock/timers/fire` to pop the next stub and sweep all state machine resources. Any resource whose `onTimer` deadline has passed (relative to the stub's `now`) is transitioned and its events emitted.

```bash
# Register a timer stub — tell the server what time to assume when fired
curl -X POST http://localhost:1080/mock/stubs/timers \
  -H "Content-Type: application/json" \
  -d '{"now": "2026-01-20T00:00:00.000Z"}'

# Fire the timer — sweeps all resources for due onTimer entries
curl -X POST http://localhost:1080/mock/timers/fire
# → { "fired": true, "now": "2026-01-20T...", "transitioned": [{ "collection": "tasks", "id": "...", "from": "pending", "to": "escalated" }] }
```

**Other timer stub endpoints:**

```bash
curl http://localhost:1080/mock/stubs/timers          # list
curl -X DELETE http://localhost:1080/mock/stubs/timers  # clear all
curl -X DELETE http://localhost:1080/mock/stubs/timers/timer-1  # remove one
```

Stubs are consumed FIFO — register multiple to simulate advancing time in steps.

## Domain Events

### SSE Event Stream

Subscribe to live domain events as they fire:

```bash
curl -N http://localhost:1080/platform/events/stream
```

Each event is a Server-Sent Events message with the full CloudEvents 1.0 envelope as JSON.

### Injecting External Events

To simulate an event from another domain (e.g., a data exchange result arriving):

```bash
curl -X POST http://localhost:1080/platform/events \
  -H "Content-Type: application/json" \
  -d '{
    "specversion": "1.0",
    "type": "org.codeforamerica.safety-net-blueprint.data_exchange.call.completed",
    "source": "/data-exchange",
    "subject": "<service-call-id>",
    "data": { "result": "conclusive", "serviceType": "fdsh_ssa" }
  }'
```

This fires the event to the event bus, triggering any subscribed rule sets exactly as if it came from a real adapter.

## Event Stubs

For event-driven flows where the mock server needs to respond to events from external services (e.g., simulating a data exchange returning a result), pre-program responses in the stub registry before triggering the flow.

**How it works:** A mock rule subscribes to a domain event and calls `applyStub`. When `applyStub` fires, it checks the registry for a matching stub, pops it (FIFO), and fires the response event. If no stub matches, the mock rule's `fallback` fires instead.

**Register an event stub:**

```bash
curl -X POST http://localhost:1080/mock/stubs/events \
  -H "Content-Type: application/json" \
  -d '{
    "on": "data_exchange.service_call.created",
    "match": { "data.serviceType": "fdsh_ssa" },
    "respond": {
      "type": "data_exchange.call.completed",
      "subject": { "var": "this.subject" },
      "data": {
        "serviceCallId": { "var": "this.subject" },
        "serviceType": "fdsh_ssa",
        "requestingResourceId": { "var": "this.data.requestingResourceId" },
        "result": "inconclusive"
      }
    }
  }'
```

- `on` — the CloudEvents type suffix to match (underscores, no platform prefix)
- `match` — optional dot-path field matchers against the event envelope; all must match
- `respond` — the event to fire when matched; field values may be JSON Logic expressions resolved against the triggering event envelope

**Stubs are consumed in order (FIFO).** Register multiple stubs to script a sequence — the first matching stub is popped each time a matching event fires.

**Stub IDs** are human-readable: `service_call.created-1`, `service_call.created-2`, etc.

**Other event stub endpoints:**

```bash
curl http://localhost:1080/mock/stubs/events                                  # list
curl -X DELETE http://localhost:1080/mock/stubs/events/service_call.created-1  # remove one
curl -X DELETE http://localhost:1080/mock/stubs/events                         # clear all
```

**Without stubs:** If no stub matches, each mock simulation rule defines its own `fallback` — typically a default fixture response so flows work out of the box. Stubs are only needed when you want to test specific outcomes. Check the relevant rule file in `packages/mock-server/mock-rules/` to see what the fallback returns.

## Configuration

```bash
MOCK_SERVER_HOST=0.0.0.0 MOCK_SERVER_PORT=8080 npm run mock:start
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run mock:start` | Start server (seeds from `packages/mock-server/seed/` on startup) |
| `npm run mock:seed` | Regenerate seed files from OpenAPI schemas |
| `npm run mock:reset` | Clear all data (restart server to reseed) |

## Troubleshooting

**Port in use:**
```bash
lsof -ti:1080 | xargs kill
```

**Wrong data:**
```bash
npm run mock:reset   # clear all data
npm run mock:start   # restart to reseed from seed files
```

**Search not working:** Ensure examples have searchable string fields.
