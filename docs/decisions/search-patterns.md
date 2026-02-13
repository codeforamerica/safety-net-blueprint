# ADR: Search and Filtering Pattern for REST APIs

**Status:** Accepted

**Date:** 2025-12-11

**Deciders:** Development Team

---

## Context

The Safety Net Blueprint needed a generic search and filtering capability for list endpoints across all REST APIs (Persons, Applications, Households).

### Requirements

- Minimal changes to REST API specs
- Generic approach that works across all resources
- Backend-agnostic implementation
- Simple for API consumers to use
- Easy to document and maintain

### Constraints

- Must work with OpenAPI 3.1 specifications
- Should not require defining field-specific query parameters for each resource
- Generated Zodios clients must support the chosen approach

---

## Decision

We chose a **single `q` query parameter with field:value search syntax** (Elasticsearch/GitHub-style) for all list endpoints.

### Example

```
GET /persons?q=status:approved income:>=1000 -state:TX
GET /applications?q=status:approved,pending programs:snap
```

---

## Options Considered

### Option 1: Simple Query Parameters (Most Common in Industry)

```
GET /users?status=active&role=admin&created_after=2024-01-01
```

**Used by:** GitHub, Stripe, Twilio

| Pros | Cons |
|------|------|
| Dead simple, self-documenting | Requires defining each filterable field in spec |
| Easy to cache | No standard for operators |
| | Spec changes needed for each new filter |

**Rejected because:** Requires field-specific parameters in each API spec.

---

### Option 2: JSON:API `filter[]` Syntax

```
GET /users?filter[status]=active&filter[age][gte]=21
```

**Used by:** Shopify, Ember ecosystem, government APIs

| Pros | Cons |
|------|------|
| Formal spec | Verbose |
| Clear namespacing | Bracket encoding issues in URLs |
| Operator support | Still requires documenting each field |

**Rejected because:** Verbose and encoding issues with brackets.

---

### Option 3: OData-style Filter Parameter

```
GET /persons?$filter=status eq 'approved' and income gte 1000
```

**Used by:** Microsoft Graph API, Salesforce SOQL

| Pros | Cons |
|------|------|
| Powerful expression syntax | Complex to parse |
| Industry standard (Microsoft) | Overkill for our needs |
| Single parameter | Requires OData parser library |

**Rejected because:** Too complex to implement and parse.

---

### Option 4: JSON-encoded Filter Parameter

```
GET /persons?filter={"status":"approved","income":{"$gte":1000}}
```

**Used by:** MongoDB Atlas API, Strapi, LoopBack

| Pros | Cons |
|------|------|
| Structured, type-safe | URL encoding makes it ugly |
| Easy to parse (JSON.parse) | Hard to read in URLs |
| Single parameter | Not shareable/bookmarkable |

**Rejected because:** URL encoding makes queries unreadable and not easily shareable.

---

### Option 5: POST /search with JSON Body

```
POST /persons/search
Content-Type: application/json

{"filter": {"status": "approved"}, "sort": ["-createdAt"]}
```

**Used by:** Elasticsearch, Algolia, MongoDB Atlas

| Pros | Cons |
|------|------|
| Clean JSON, no encoding | Not RESTful (POST for read) |
| No URL length limits | Not cacheable |
| Supports complex queries | Not bookmarkable/shareable |

**Rejected because:** Not RESTful, not cacheable, URLs not shareable.

---

### Option 6: Single `q` Parameter with Search Syntax (CHOSEN)

```
GET /persons?q=status:approved income:>=1000 name:john
```

**Used by:** Elasticsearch, GitHub Search, Jira JQL, Lucene

| Pros | Cons |
|------|------|
| Single parameter for all resources | Custom syntax to learn |
| Widely adopted pattern | URL length limits (~2KB) |
| RESTful GET requests | Requires syntax documentation |
| Cacheable | No nested boolean logic |
| Shareable/bookmarkable URLs | |
| Human-readable | |
| No spec changes for new fields | |

**Accepted because:** Best balance of simplicity, RESTfulness, and developer experience.

---

## Decision Rationale

| Factor | Benefit |
|--------|---------|
| **No field-specific parameters** | Single `q` parameter works for all resources without defining each field |
| **Widely adopted** | Developers know this pattern from GitHub, Elasticsearch, Jira |
| **RESTful** | Standard GET requests with query parameters |
| **Shareable URLs** | Queries can be bookmarked, shared, and linked directly |
| **Cacheable** | Standard HTTP caching works out of the box |
| **Simpler than JSON** | No URL encoding of JSON objects |
| **Human-readable** | `q=status:approved` is intuitive |
| **OpenAPI simplicity** | One shared parameter definition across all specs |

---

## Consequences

### Positive

- All list endpoints use consistent filtering syntax
- Single `SearchQueryParam` component shared across all API specs
- No spec changes needed when adding new filterable fields
- URLs are readable and shareable
- Standard HTTP caching works

### Negative

- Developers must learn the query syntax
- URL length limits apply (~2KB safe)
- No arbitrarily complex boolean logic (only AND/OR)
- Custom parser needed on backend

### Mitigations

To address the learning curve, we implemented:

1. **Comprehensive OpenAPI documentation** in `SearchQueryParam`
2. **TypeScript helper library** (`search-helpers.ts`) with IDE autocomplete
3. **Detailed documentation** in README_MOCK_SERVER.md

---

## Search Syntax Reference

The full syntax reference (operators, case sensitivity rules) is documented in the `SearchQueryParam` description within each API spec's list endpoint.

---

## Implementation

### Files Changed

| File | Change |
|------|--------|
| `openapi/components/common-parameters.yaml` | Added `SearchQueryParam` with documentation |
| `openapi/persons.yaml` | Replaced `search` param with `$ref` to `SearchQueryParam` |
| `openapi/applications.yaml` | Replaced `status`, `programs` params with `$ref` to `SearchQueryParam` |
| `openapi/households.yaml` | Added `$ref` to `SearchQueryParam` |
| `generated/clients/zodios/*.ts` | Regenerated with `q` parameter |
| `generated/clients/zodios/search-helpers.ts` | New TypeScript helper library |
| `docs/README_MOCK_SERVER.md` | Added search syntax documentation |

### Migration Example

```bash
# Before (hardcoded parameters)
GET /persons?search=john
GET /applications?status=approved&programs=snap&programs=cash_programs

# After (generic q parameter)
GET /persons?q=john
GET /applications?q=status:approved programs:snap,cash_programs
```

### TypeScript Helper Usage

```typescript
import { q, search } from './generated/clients/zodios/search-helpers';

const query = q(
  search.eq("status", "approved"),
  search.gte("income", 1000),
  search.in("programs", ["snap", "cash_programs"])
);
// => "status:approved income:>=1000 programs:snap,cash_programs"

const results = await api.listApplications({
  queries: { q: query }
});
```

---

## References

- [Elasticsearch Query String Syntax](https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-query-string-query.html)
- [GitHub Search Syntax](https://docs.github.com/en/search-github/getting-started-with-searching-on-github/understanding-the-search-syntax)
- [Jira JQL](https://support.atlassian.com/jira-software-cloud/docs/use-advanced-search-with-jira-query-language-jql/)
