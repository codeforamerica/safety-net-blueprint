# Mock Server

> **Status: Draft**

Development mock server that serves REST APIs from OpenAPI specs and will interpret behavioral contracts (state machines, rules, metrics) to serve RPC APIs.

> **Note:** REST API generation (CRUD endpoints from OpenAPI specs) works today. The behavioral engine described below — RPC endpoint generation from state machine triggers, guard evaluation, effect execution, rule evaluation, and metrics tracking — is being built as part of the [steel thread prototypes](../prototypes/workflow-prototype.md). This guide describes both the current and target capabilities.

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

### Behavioral Engine (planned)

For behavior-shaped domains (workflow, application review), the mock server will also:

1. Load state machine YAML, rules YAML, and metrics YAML
2. Auto-generate RPC endpoints from state machine triggers (e.g., `POST /workflow/tasks/:id/claim`)
3. Enforce state transitions, evaluate guards, and execute effects
4. Evaluate decision rules for routing, assignment, and priority
5. Track metrics linked to states and transitions

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

### RPC endpoints (planned)

For behavior-shaped domains, RPC endpoints are auto-generated from state machine triggers:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/workflow/tasks/:id/claim` | Trigger a state transition with guard enforcement |
| POST | `/workflow/tasks/:id/complete` | Trigger a state transition with effects |

A 409 response means the transition is invalid from the current state or a guard condition failed.

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
