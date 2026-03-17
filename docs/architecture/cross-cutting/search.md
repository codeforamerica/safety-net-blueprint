# Search (Cross-Cutting)

> **Status: Alpha** — Breaking changes expected. See the [OpenAPI spec](../../../packages/contracts/search-openapi.yaml) for the full contract.

See [Domain Design Overview](../domain-design.md) for context and [Contract-Driven Architecture](../contract-driven-architecture.md) for the contract approach.

## Overview

Search is cross-cutting because it spans all domains — caseworkers need a single search bar to find people, cases, households, and applications without knowing which resource type to look for.

## Key Architectural Decisions

### REST over GraphQL

A `GET /search` endpoint follows the same paradigm as every other API in the blueprint. GraphQL would introduce a second query paradigm, a separate toolchain (schema stitching, resolvers, client libraries), and there is little real-world precedent for modeling global search as a GraphQL query rather than a dedicated endpoint. Search is simple query-in, list-out — REST handles that well.

### Uniform result shape over polymorphic

Each result has the same shape (`id`, `type`, `title`, `url`, `attributes[]`) regardless of resource type. The alternative — polymorphic results where each type returns its own schema — would require clients to maintain per-type rendering logic, and adding a new searchable resource type would require client code changes.

With the uniform shape, new resource types are automatically supported — the backend maps any resource into the same `SearchResult` structure, and clients render the `attributes` array without knowing what they contain.

### Typed attributes

Each attribute carries a `field` (machine-readable key like `dob`, `status`), an optional `label` (human-readable display name like "Date of Birth"), and a `type` hint (`string`, `date`, `currency`) so clients can apply smart formatting (e.g., render dates in the user's locale, format currency values). Clients that need custom display names key off `field`; clients that just want a default label use `label` as-is.

### Title mapping left to implementers

The `title` field on each search result is a display string — but the spec intentionally does not prescribe which field from each resource type maps to it. Different implementations may have different conventions (e.g., a state that uses case numbers prominently vs. one that leads with client names).

For example, a person result might use the full name ("Jane Smith") while a case result might use the case number ("CASE-2026-00142").

This may be formalized in a future version — for example, via an `x-title-field` extension on `SearchResultType` or a configuration object in the search service — but for now, implementers choose the most useful display value for their context.

### Facets included in response

Any search UI needs per-type counts to show "People (12) | Cases (5) | Applications (3)" filter tabs. Including `facets` in the response avoids a separate counting request.

## Alternatives Considered

| Approach | Trade-off |
|----------|-----------|
| **GraphQL search query** | Second paradigm and toolchain; search is simple query-in/list-out; no real-world precedent for global search via GraphQL |
| **Polymorphic results** (per-type schemas) | Clients need per-type rendering; adding resource types requires client changes |
| **Untyped attributes** (field + value only) | Clients can't format values intelligently; every value is plain text |

## Future Considerations

- **Result highlighting** — Return match positions so clients can highlight search terms in results
- **Autocomplete** — A `GET /search/suggest` endpoint for type-ahead suggestions as the user types

## Related Documents

| Document | Description |
|----------|-------------|
| [Search API Spec](../../../packages/contracts/search-openapi.yaml) | OpenAPI specification |
| [Domain Design](../domain-design.md) | Search section in the domain overview |
