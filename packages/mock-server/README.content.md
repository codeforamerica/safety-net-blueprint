## What It Does

An Express-based mock API server that auto-discovers OpenAPI specs, creates SQLite databases, and seeds them from example files. Use it for frontend development without a production backend.

- Auto-discovers all `*-openapi.yaml` specs
- Creates per-spec SQLite databases with full CRUD support
- Seeds databases from `*.yaml` seed files in `packages/mock-server/seed/`
- Supports search, pagination, and filtering
- Includes Swagger UI for interactive API exploration

## CLI Commands

These commands are installed as bin scripts. Run them via npm scripts in your `package.json` or with `npx`.

### `safety-net-mock`

Start the mock API server.

```json
"scripts": {
  "mock": "safety-net-mock --spec=./resolved"
}
```

### `safety-net-swagger`

Start the Swagger UI server.

```json
"scripts": {
  "swagger": "safety-net-swagger --spec=./resolved"
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MOCK_SERVER_HOST` | `localhost` | Server bind address |
| `MOCK_SERVER_PORT` | `1080` | Server port |
| `SKIP_VALIDATION` | `false` | Skip spec validation on startup |

## Testing timer-triggered behavior

Timers in the state machine are implemented as events: `requestTimer` emits `scheduling.timer.requested`, and the scheduling service delivers `scheduler.timer.fired` when the timer expires. In the mock, simulate a timer firing by stubbing the `scheduler.timer.fired` event directly:

```
POST /mock/stubs/events
{
  "name": "scheduler.timer.fired",
  "data": {
    "subject": "task-123",
    "timerType": "creation_deadline"
  }
}
```

The stub is consumed on the next matching event subscription trigger. Because timer IDs are deterministic (`{domain}-{timerType}-{objectId}`), the full payload is known from the object ID alone — no need to inspect the event log first.
