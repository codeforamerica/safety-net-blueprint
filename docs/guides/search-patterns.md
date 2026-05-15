# Search Query Syntax

> **Status: Draft**

Use the `q` parameter on list endpoints to filter results. See [Search Patterns Decision](../decisions/search-patterns.md) for the design rationale.

## Quick Examples

```bash
# Full-text search
curl "http://localhost:1080/persons?q=john"

# Field match
curl "http://localhost:1080/persons?q=status:active"

# Comparison
curl "http://localhost:1080/persons?q=income:>=1000"

# Multiple conditions (AND)
curl "http://localhost:1080/persons?q=status:active%20income:>=1000"
```

## Case Sensitivity

| Search Type | Case Sensitive |
|-------------|----------------|
| Exact match (`field:value`) | Yes |
| Full-text exact (`term`) | Yes |
| Wildcard patterns (`*`) | No |

## Operators

| Pattern | Description | Example | Case Sensitive |
|---------|-------------|---------|----------------|
| `term` | Full-text exact match | `john` | Yes |
| `*term*` | Full-text contains | `*john*` | No |
| `term*` | Full-text starts with | `john*` | No |
| `*term` | Full-text ends with | `*john` | No |
| `field:value` | Exact match | `status:active` | Yes |
| `field:*value*` | Contains | `name:*john*` | No |
| `field:value*` | Starts with | `name:john*` | No |
| `field:*value` | Ends with | `name:*son` | No |
| `field:>value` | Greater than | `income:>1000` | - |
| `field:>=value` | Greater or equal | `income:>=1000` | - |
| `field:<value` | Less than | `income:<5000` | - |
| `field:<=value` | Less or equal | `income:<=5000` | - |
| `field:a,b` | Match any (OR) | `status:active,pending` | Yes |
| `-field:value` | Exclude | `-status:denied` | Yes |
| `field:*` | Field exists | `email:*` | - |
| `-field:*` | Field does not exist | `-email:*` | - |
| `field.nested:value` | Nested field | `address.state:CA` | Yes |
| `term1 term2` | Multiple conditions (AND) | `status:active income:>=1000` | - |

## Sorting

List endpoints that declare the `x-sortable` extension accept a `sort` query parameter. The syntax is comma-separated fields, with a `-` prefix for descending order:

```
GET /workflow/tasks?sort=-priority,dueDate
GET /intake/applications?sort=submittedAt
GET /platform/events?sort=time
```

Dot-notation reaches nested fields when the spec allows it (`?sort=name.lastName`).

### Error codes

| Status | Code | Meaning |
|---|---|---|
| 400 | `FIELD_NOT_SORTABLE` | The field exists on the response schema but is not in `x-sortable.fields`. |
| 400 | `INVALID_SORT_FIELD` | The field doesn't exist on the schema, fails the lexical rule, or the endpoint does not declare `x-sortable` at all. |

### Implementing `x-sortable` in an adapter

These are the contract-driven invariants every adapter (mock or production) must honor:

1. **Lexical validation.** Every entry in `x-sortable.fields`, `x-sortable.default`, and `x-sortable.tieBreaker` matches `^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$`. The pattern validator enforces this at lint time, but adapters MUST re-validate at runtime as defense in depth — sort field names are typically interpolated into expression languages (SQL identifiers, GraphQL field paths) that don't parameterize identifiers.
2. **`maxFields` floor.** When the spec omits `maxFields`, adapters MUST apply an implicit ceiling (recommended: 5) to bound query cost.
3. **Tie-breaker is required.** The configured `tieBreaker` field (default: `id`) MUST be appended to every effective sort. Without it, pagination is non-deterministic across pages.
4. **Information disclosure.** Sort order is an oracle — a field's ordering can leak information about records even when the field itself isn't projected (binary-search via pagination). Adapters SHOULD warn at deploy time if `x-sortable.fields` contains fields tagged `x-pii: true` or matching obvious sensitive patterns (`ssn`, `dateOfBirth`, internal risk scores). The pattern validator surfaces this as a Spectral warning.
5. **Failed-parse logging.** Adapters SHOULD log failed sort parses at info level with the offending field name (not the raw query string, which may carry PII from other params).

See [`x-extensions.md#x-sortable`](../architecture/x-extensions.md#x-sortable) for the extension shape and [`api-patterns.yaml#sorting`](../../packages/contracts/patterns/api-patterns.yaml) for the full convention.

## TypeScript Search Helpers

When using generated TypeScript clients, you can build queries programmatically:

```typescript
import { q, search } from './generated';

const query = q(
  search.eq('status', 'active'),
  search.gte('monthlyIncome', 1000),
  search.contains('name.lastName', 'smith')
);
// Result: "status:active monthlyIncome:>=1000 name.lastName:*smith*"
```

See [API Clients - Search Helpers](../integration/api-clients.md#search-helpers) for the complete reference.
