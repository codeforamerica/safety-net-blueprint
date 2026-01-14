# Search Query Syntax

Use the `q` parameter on list endpoints to filter results.

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

## TypeScript Search Helpers

When using the generated npm packages, you can build queries programmatically:

```typescript
import { q, search } from '@codeforamerica/safety-net-<your-state>';

const query = q(
  search.eq('status', 'active'),
  search.gte('monthlyIncome', 1000),
  search.contains('name.lastName', 'smith')
);
// Result: "status:active monthlyIncome:>=1000 name.lastName:*smith*"
```

See [API Clients - Search Helpers](../integration/api-clients.md#search-helpers) for the complete reference.
