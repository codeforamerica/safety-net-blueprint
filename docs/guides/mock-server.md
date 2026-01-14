# Mock Server

Auto-generated mock APIs from OpenAPI specs with SQLite persistence.

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

1. Discovers specs from `/openapi/*.yaml`
2. Seeds SQLite databases from `/openapi/examples/`
3. Generates CRUD endpoints automatically
4. Validates requests against schemas

## Auto-Generated Endpoints

For each spec (e.g., `persons.yaml`):

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/persons` | List with pagination & search |
| GET | `/persons/{id}` | Get by ID |
| POST | `/persons` | Create |
| PATCH | `/persons/{id}` | Update |
| DELETE | `/persons/{id}` | Delete |

## Search Query Syntax

Use the `q` parameter for filtering. See [Search Patterns](./search-patterns.md) for full syntax reference.

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
