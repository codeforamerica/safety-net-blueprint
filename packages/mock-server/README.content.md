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

## Testing onTimer triggers

Timers in the state machine schema use `relativeTo:` to measure elapsed time from a resource field like `createdAt`. The mock server provides two ways to simulate time advancing.

### Inline fire (no pre-registration needed)

Send the desired "now" directly in the fire request body. Use a relative offset — the server adds it to the current real clock at fire time. Any resource whose timer deadline falls within the offset window will fire.

```
POST /mock/timers/fire
{ "now": "+72h" }
```

This says: "act as if 72 hours have passed since now." For a timer defined as `after: 72h, relativeTo: createdAt`, a resource created during the test will have `createdAt ≈ now`, so `createdAt + 72h ≤ now + 72h` — the timer fires.

**Supported offset formats:** `+72h`, `+7d`, `+30m`, `-48h` (negative = simulate time in the past).

You can also pass an absolute ISO timestamp:

```
POST /mock/timers/fire
{ "now": "2025-06-01T12:00:00Z" }
```

### Pre-registered queue (for sequenced scenarios)

Register stubs in the order you want them to fire, then pop them one at a time:

```
POST /mock/stubs/timers          POST /mock/stubs/timers
{ "now": "+24h" }                { "now": "+72h" }

POST /mock/timers/fire   ← fires first stub  (+24h)
POST /mock/timers/fire   ← fires second stub (+72h)
```

Both absolute timestamps and relative offsets are accepted in stubs.

**Other stub endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/mock/stubs/timers` | List queued stubs |
| `DELETE` | `/mock/stubs/timers/:id` | Remove a specific stub |
| `DELETE` | `/mock/stubs/timers` | Clear all stubs |

### Known limitation: `calendarType: business`

The schema supports `calendarType: business` on `onTimer` entries to express durations in business hours rather than calendar time. The mock treats this the same as `calendarType: calendar` — it does not skip nights or weekends. A warning is logged to the console when a timer with `calendarType: business` fires.

To test a `calendarType: business` timer in the mock, use the calendar-equivalent offset. For a 72-business-hour timer on a standard Mon–Fri workweek, 72 business hours ≈ 9 calendar days:

```
POST /mock/timers/fire
{ "now": "+9d" }
```

Real business-hours enforcement requires a business calendar definition (hours, timezone, holidays) that varies by state and is not part of the baseline mock.
