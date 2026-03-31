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
