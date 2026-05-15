# Mock Server

Development server that serves REST APIs from OpenAPI specs and behavioral contracts (state machines, rules, metrics). Everything is generated from contracts at startup — there is no hand-written endpoint code.

## Quick Start

```bash
npm run mock:start    # Start server (port 1080)
```

```bash
curl http://localhost:1080/health
# → { "status": "ok", "apis": ["intake", "workflow", ...] }
```

## What gets served

**REST endpoints** — generated from each OpenAPI spec (`*-openapi.yaml`): list, get, create, update, delete. Requests are validated against schemas; errors return the shared error shape.

**RPC endpoints** — generated from state machine files (`*-state-machine.yaml`): one `POST /{domain}/{resource}/:id/{operation}` per transition. The server enforces valid state transitions (409 on invalid), evaluates guards, executes steps, tracks SLA clocks, and fires domain events.

**Metrics endpoints** — generated from metrics files (`*-metrics.yaml`): `GET /{domain}/metrics` and `GET /{domain}/metrics/{id}`, computed on-the-fly from live data.

Adding a new operation or resource requires only a contract change.

## Seed data

The server seeds its in-memory database from YAML files in `packages/mock-server/seed/` at startup. Each file covers one domain (e.g., `workflow.yaml`). The key prefix (e.g., `Task`, `Queue`) identifies the collection.

Some resources — queues and other catalog entries — are defined in `*-config.yaml` files and seeded as system-managed records. These are separate from the hand-edited seed files.

To reset all data:
```bash
npm run mock:reset   # clear all data
npm run mock:start   # restart to reseed
```

To regenerate seed files from current schemas:
```bash
npm run mock:seed
```

## Caller context

State machine operations use two headers to identify who is making the request:

| Header | Description |
|--------|-------------|
| `X-Caller-Id` | ID of the acting user (used in `$caller.id` expressions, e.g., to assign a task to the claiming worker) |
| `X-Caller-Roles` | Comma-separated roles (e.g., `caseworker,supervisor`). Operations with actor restrictions return 403 if none of the caller's roles match. |

```bash
curl -X POST http://localhost:1080/workflow/tasks/<id>/claim \
  -H "X-Caller-Id: 00000002-0000-0000-0000-000000000001" \
  -H "X-Caller-Roles: caseworker"
```

**Response codes from RPC endpoints:**
- `403` — the caller's roles don't satisfy the operation's actor requirements
- `409` — the resource is in the wrong state for this transition, or a guard condition failed
- `422` — the request body failed schema validation

## Domain events

### Watching the event stream

Subscribe to live events as they fire:

```bash
curl -N http://localhost:1080/platform/events/stream
```

Each message is a Server-Sent Events frame with the full CloudEvents 1.0 envelope as JSON.

### Firing events

There are two ways to fire an event into the bus:

**`POST /platform/events`** — fire a full CloudEvents 1.0 envelope directly:

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

**`POST /mock/stubs/events`** — a convenience wrapper around `POST /platform/events`. You only specify the delta; the stub engine builds the full envelope and posts it to the platform for you. See [Event stubs](#event-stubs) below.

## Event stubs

An event stub is a convenience wrapper around `POST /platform/events`. Instead of constructing the full CloudEvents envelope yourself, you specify the event type and just the fields that differ — the stub engine fills in the rest.

When any event fires, the engine scans registered stubs in order (FIFO) and pops the first one whose `on` and `match` criteria fit. If nothing matches, the event fires normally.

```bash
curl -X POST http://localhost:1080/mock/stubs/events \
  -H "Content-Type: application/json" \
  -d '{
    "on": "data_exchange.service_call.created",
    "match": { "data.serviceType": "fdsh_ssa" },
    "respond": {
      "type": "data_exchange.call.completed",
      "data": { "result": "inconclusive" }
    }
  }'
```

- `on` — the CloudEvents type suffix to match (no platform prefix, underscores)
- `match` — optional dot-path field matchers against the event envelope; all must match
- `respond.type` — the event type to fire when matched
- `respond.data` — merged with the trigger event's data; only specify what changes

The response envelope is built by merging: an entity ID derived from the trigger's `subject` (e.g., `serviceCallId`), the trigger event's data, then `respond.data` overrides.

**Stub IDs** are human-readable: `service_call.created-1`, `service_call.created-2`, etc.

### Timer stubs

Timer stubs are a variant for `scheduling.timer.requested` events. The callback event type and data are embedded in the triggering event itself, so no `respond` block is needed — the stub engine reads them directly.

```bash
# Register a stub for creation_deadline timers
curl -X POST http://localhost:1080/mock/stubs/events \
  -H "Content-Type: application/json" \
  -d '{
    "on": "scheduling.timer.requested",
    "match": { "data.callback.event": "workflow.creation_deadline" }
  }'

# Create a task — task creation schedules the timer, stub fires it immediately
curl -X POST http://localhost:1080/workflow/tasks \
  -H "Content-Type: application/json" \
  -H "X-Caller-Id: 00000002-0000-0000-0000-000000000001" -H "X-Caller-Roles: caseworker" \
  -d '{"name":"Test","taskType":"application_review","subjectType":"application","subjectId":"00000000-0000-0000-0000-000000000001"}'

# Task should now be escalated
curl http://localhost:1080/workflow/tasks/<id> | jq .status
# → "escalated"
```

Match on `data.callback.event` — the event type embedded in the scheduling request. Omit `match` to match any timer request regardless of type.

### Managing event stubs

```bash
curl http://localhost:1080/mock/stubs/events                                    # list all
curl -X DELETE http://localhost:1080/mock/stubs/events/service_call.created-1   # remove one
curl -X DELETE http://localhost:1080/mock/stubs/events                          # clear all
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
| `npm run mock:start` | Start server, seeds from `packages/mock-server/seed/` |
| `npm run mock:seed` | Regenerate seed files from current schemas |
| `npm run mock:reset` | Clear all data (restart to reseed) |

## Troubleshooting

**Port in use:**
```bash
lsof -ti:1080 | xargs kill
```

**Stale or wrong data:**
```bash
npm run mock:reset
npm run mock:start
```

**Search not working:** Check that the seeded examples have non-empty string fields to search against.
