# Mock Server

> **Status: Draft**

Development mock server that serves REST APIs from OpenAPI specs and will interpret behavioral contracts (state machines, rules, metrics) to serve RPC APIs.

> **Note:** REST API generation (CRUD endpoints from OpenAPI specs) and the core behavioral engine (state machine transitions, guards, `set`, `create`, `evaluate-rules`, and `event` effects) work today. SLA clock tracking and metrics computation are also implemented. Additional behavioral capabilities — cross-domain event wiring, role-based access control enforcement — are planned.

## Quick Start

```bash
# Set your state first
export STATE=<your-state>

npm run mock:start    # Start server (port 1080)
npm run mock:reset    # Reset database to example data
```

Test it:
```bash
curl http://localhost:1080/persons
```

## How It Works

### REST APIs (works today)

1. Discovers specs from `/openapi/*.yaml`
2. Seeds SQLite databases from `/openapi/examples/`
3. Generates CRUD endpoints automatically
4. Validates requests against schemas

### Behavioral Engine

For behavior-shaped domains (workflow, application review), the mock server also interprets behavioral contracts:

**Works today:**
1. Load state machine YAML and auto-generate RPC endpoints from triggers (e.g., `POST /workflow/tasks/:id/claim`)
2. Enforce state transitions — reject invalid transitions with 409
3. Evaluate guards (null checks, caller identity)
4. Execute `set` effects (update fields on the resource)
5. Execute `create` effects (write records to other collections, e.g., audit events)
6. Execute `evaluate-rules` effects (invoke decision rules for routing and priority)
7. Execute `event` effects (emit domain events)
8. Compute SLA tracking — initialize `slaInfo` at task creation, update status on every transition using `pauseWhen`/`resumeWhen` conditions from `*-sla-types.yaml`
9. Serve `GET /metrics` and `GET /metrics/{metricId}` — compute count, ratio, and duration aggregates from live data

Adding a transition is a table row, not endpoint code.

## Auto-Generated Endpoints

### REST endpoints (works today)

For each spec (e.g., `persons.yaml`):

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/persons` | List with pagination & search |
| GET | `/persons/{id}` | Get by ID |
| POST | `/persons` | Create |
| PATCH | `/persons/{id}` | Update |
| DELETE | `/persons/{id}` | Delete |

### RPC endpoints (works today)

For behavior-shaped domains, RPC endpoints are auto-generated from state machine triggers:

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

## Clock Override (X-Mock-Now)

To simulate SLA behavior at a specific point in time, pass the `X-Mock-Now` header with an ISO datetime value. This overrides the server clock for that request — useful for testing SLA warning and breach scenarios without waiting.

```bash
# Simulate a request made 25 days after a task was created
curl -X POST http://localhost:1080/workflow/tasks/task-001/complete \
  -H "X-Caller-Id: worker-001" \
  -H "X-Mock-Now: 2025-03-15T10:00:00Z"
```

The override affects:
- SLA status computation (when `slaInfo` entries are evaluated for `warning` or `breached`)
- The `clockStartedAt` and `deadline` values stored on newly created SLA entries

**Simulating pause/resume scenarios:** Pause duration is computed as the difference between the `X-Mock-Now` value at resume and the `X-Mock-Now` value at pause. Both steps must use the same clock — if you pause without `X-Mock-Now` and resume with it (or vice versa), the duration will be wrong. To simulate a 3-day pause: set `X-Mock-Now` at the pause step, then set it to 3 days later at the resume step. To test breach after resuming, send a third request with `X-Mock-Now` set past the extended deadline (returned in the resume response).

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

### Mock Stub Registry

For event-driven flows where the mock server itself needs to respond to events (e.g., simulating an external service responding to a service call), use the stub registry to pre-program responses before triggering the flow.

**How it works:** Mock simulation rules subscribe to domain events and call `applyStub`. When `applyStub` fires, it checks the stub registry for a matching pre-registered response, pops it (FIFO), and fires the response event. If no stub matches, the rule's `fallback` fires instead. See [`packages/mock-server/mock-rules/README.md`](../../packages/mock-server/mock-rules/README.md) for how mock simulation rules are written and loaded.

**Register a stub:**

```bash
curl -X POST http://localhost:1080/mock/stubs \
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

**Other stub endpoints:**

```bash
# List active stubs
curl http://localhost:1080/mock/stubs

# Remove a specific stub
curl -X DELETE http://localhost:1080/mock/stubs/service_call.created-1

# Clear all stubs
curl -X DELETE http://localhost:1080/mock/stubs
```

**Without stubs:** If no stub matches, each mock simulation rule defines its own `fallback` — typically a default fixture response so flows work out of the box. Stubs are only needed when you want to test specific outcomes. Check the relevant rule file in `packages/mock-server/mock-rules/` to see what the fallback returns.

## Search Query Syntax

Use the `q` parameter for filtering. See [Search Patterns](../decisions/search-patterns.md) for full syntax reference.

```bash
curl "http://localhost:1080/persons?q=status:active income:>=1000"
```

## Pagination

| Parameter | Default | Range |
|-----------|---------|-------|
| `limit` | 25 | 1-100 |
| `offset` | 0 | 0+ |

```bash
curl "http://localhost:1080/persons?limit=10&offset=20"
```

Response:
```json
{
  "items": [...],
  "total": 100,
  "limit": 10,
  "offset": 20,
  "hasNext": true
}
```

## Sorting (`?sort=`)

The mock server honors the `x-sortable` extension on every list endpoint:

```bash
curl "http://localhost:1080/workflow/tasks?sort=-priority,dueDate"
```

Mock-specific behavior:

- Endpoints without `x-sortable` reject any `?sort=` with `400 INVALID_SORT_FIELD` — the parameter is not silently ignored.
- When the spec omits `maxFields`, the mock server applies an implicit ceiling of 5.
- Null values sort last on ascending order, first on descending.

For the full sort syntax, error codes, and adapter implementation guidance, see [Search Patterns — Sorting](search-patterns.md#sorting).

## Configuration

```bash
MOCK_SERVER_HOST=0.0.0.0 MOCK_SERVER_PORT=8080 npm run mock:start
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run mock:start` | Start server |
| `npm run mock:setup` | Initialize databases |
| `npm run mock:reset` | Clear and reseed databases |

## Troubleshooting

**Port in use:**
```bash
lsof -ti:1080 | xargs kill
```

**Wrong data:**
```bash
npm run mock:reset
```

**Search not working:** Ensure examples have searchable string fields.
