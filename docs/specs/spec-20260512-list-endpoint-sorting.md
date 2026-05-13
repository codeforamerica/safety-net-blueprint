---
title: List endpoint sorting
status: draft
authors: [Leo Kacenjar]
approvers: []
categories: []
date: 2026-05-12
---

## Summary

The blueprint's `api-patterns.yaml` documents a standard `sort` query parameter convention for list endpoints, but no spec, component, or mock server code implements it. This work implements the convention end-to-end: contract authors declare sortable fields on each list endpoint, the mock server honors `?sort=...` queries with validated ordering and stable pagination, and generated TypeScript clients pass the parameter through to the server. Consumers gain the ability to sort list results without reading the full collection client-side.

## What exists today

- `packages/contracts/patterns/api-patterns.yaml#sorting` defines the `?sort=field,-otherField` syntax, error codes (`INVALID_SORT_FIELD`, `FIELD_NOT_SORTABLE`), and indexing guidance. The section is annotated `STATUS: Not yet implemented`.
- No `SortParam` component exists in `packages/contracts/components/parameters.yaml`.
- No domain spec references a `sort` parameter. List endpoints (e.g., `GET /workflow/tasks`, `GET /intake/applications`) accept only `q`, `limit`, and `offset`.
- The mock server hardcodes `ORDER BY COALESCE(json_extract(data, '$.createdAt'), '1970-01-01T00:00:00Z') DESC` in `packages/mock-server/src/search-engine.js`. Any `sort` query parameter sent by a client is silently ignored.
- Generated TypeScript clients (via `@hey-api/openapi-ts`) reflect whatever parameters are in the spec — so today the `sort` parameter does not appear on list operation types.

## What should change

### Contract authoring

Each list operation that supports sorting MUST declare `x-sortable` as an OpenAPI extension on the operation. All sort-related configuration lives under this single extension:

```yaml
get:
  operationId: listTasks
  x-sortable:
    fields: [createdAt, priority, dueDate, status]
    default: -priority,dueDate    # optional
    tieBreaker: id                 # optional; defaults to id
    maxFields: 3                   # optional; no limit if absent
  parameters:
    - $ref: "./components/parameters.yaml#/SortParam"
    - $ref: "./components/parameters.yaml#/LimitParam"
    - ...
```

- `fields` (required when `x-sortable` is present): an array of field names that may appear in a client's `sort` query parameter. Field names use dot-notation for nested fields (e.g., `name.lastName`, `citizenshipInfo.status`). Validated by the spec linter against the resource's response schema.
- `default` (optional): a string in the same comma-separated `field,-otherField` format that the `sort` parameter accepts. Applied when the client omits `sort`. If absent, the response order is whatever the database produces (no implicit sort) — except for the `tieBreaker` which is always appended.
- `tieBreaker` (optional, defaults to `id`): a single field name appended to every effective sort to guarantee deterministic ordering. Specs that genuinely don't have a usable tie-breaker set this to `null` explicitly.
- `maxFields` (optional, no limit if absent): an integer cap on the number of fields a client may include in `?sort=`. The pattern doc continues to recommend 3.

A shared `SortParam` component MUST be defined once in `components/parameters.yaml` and referenced from every sort-enabled list endpoint.

### Runtime behavior — happy path

```gherkin
Scenario Outline: Sort list endpoint by a single field
  Given a list endpoint declares x-sortable.fields including <field>
  And the endpoint declares x-sortable.default: <default>
  When a client requests ?sort=<query>
  Then the response items are ordered by <expectedOrder>
  And response status is 200

  Examples:
    | field      | default       | query        | expectedOrder                              |
    | createdAt  | -createdAt    | createdAt    | createdAt ascending, id ascending          |
    | createdAt  | -createdAt    | -createdAt   | createdAt descending, id ascending         |
    | priority   | -createdAt    | -priority    | priority descending, id ascending          |
    | (omitted)  | -priority     | (omitted)    | priority descending, id ascending          |
```

```gherkin
Scenario: Multi-field sort
  Given a list endpoint declares x-sortable.fields: [priority, dueDate, createdAt]
  When a client requests ?sort=-priority,dueDate
  Then items are ordered first by priority descending, then by dueDate ascending,
       then by id ascending as a final tie-breaker
  And response status is 200
```

```gherkin
Scenario: Nested-field sort
  Given a list endpoint for /client-management/persons declares
        x-sortable.fields: [name.lastName, dateOfBirth]
  When a client requests ?sort=name.lastName
  Then items are ordered by name.lastName ascending, then by id ascending
  And response status is 200
```

### Stable pagination

The mock server MUST append the endpoint's declared `tieBreaker` field (default: `id`) as a final ascending sort on every query. The tie-breaker is declared in the contract via `x-sortable.tieBreaker`, not hardcoded in the adapter. Clients do not include it in `?sort=`, and it does not appear in `x-sortable.fields` — it's separate config.

```gherkin
Scenario: Pagination is stable across pages with the same sort
  Given a collection of 10 tasks with overlapping priority values
  When a client requests page 1 with ?sort=-priority&limit=4&offset=0
  And then requests page 2 with ?sort=-priority&limit=4&offset=4
  Then no record appears on both pages
  And no record between offset 0 and offset 8 is skipped
```

### Error handling

```gherkin
Scenario: Unknown field
  Given a list endpoint declares x-sortable.fields: [createdAt, priority]
  When a client requests ?sort=nonexistent
  Then the response status is 400
  And the response body code is "INVALID_SORT_FIELD"
  And the response body message identifies the unknown field

Scenario: Declared resource field that is not in x-sortable.fields
  Given a list endpoint declares x-sortable.fields: [createdAt, priority]
  And the resource schema includes a description field
  When a client requests ?sort=description
  Then the response status is 400
  And the response body code is "FIELD_NOT_SORTABLE"
  And the response body message identifies the field

Scenario: List endpoint with no x-sortable.fields declaration
  Given a list endpoint does NOT declare x-sortable.fields
  When a client requests ?sort=anyField
  Then the response status is 400
  And the response body code is "INVALID_SORT_FIELD"

Scenario: List endpoint with no x-sortable.fields, no sort param
  Given a list endpoint does NOT declare x-sortable.fields
  When a client requests the endpoint without ?sort=
  Then the response status is 200
  And items are returned in whatever order the database produced
```

A list endpoint MAY ship without `x-sortable.fields` (signaling that sorting is not yet supported on that endpoint). When that's the case, any client-supplied `sort` parameter is rejected, but the endpoint continues to work for unsorted queries.

### Spec linting

`validate-patterns.js` MUST verify, for every list endpoint that declares `x-sortable.fields`:

1. Each field name in `x-sortable.fields` exists on the resource's response schema (top-level or nested, following `$ref`, `allOf`, and `oneOf` branches).
2. The endpoint also declares `x-sortable.default`, and every field referenced in `x-sortable.default` appears in `x-sortable.fields`.
3. The endpoint includes the `SortParam` component reference in its parameters list.

Failing any of these MUST produce a validation error that names the endpoint, the field, and the missing declaration.

### Generated TypeScript clients

`@hey-api/openapi-ts` will generate the `sort` parameter as `sort?: string` based on the `SortParam` definition. No codegen customization is required. The OpenAPI spec is the source of truth for which fields are valid; runtime errors flag invalid sort values at the API boundary.

This is a deliberate trade-off: clients can construct any string they want, but they get immediate feedback from the server when they get it wrong. The blueprint does not invest in compile-time type safety for sort parameters in v1.

### Migration of existing list endpoints

All existing list endpoints across `workflow`, `intake`, `data-exchange`, `client-management`, `scheduling`, `document-management`, and `identity-access` SHOULD declare `x-sortable.fields` and `x-sortable.default` as part of this work. Endpoints that genuinely have no useful sort use case (e.g., singleton sub-resources) MAY omit the declaration; they will continue to work without sort support.

`x-sortable.default` SHOULD match the current de facto behavior (`-createdAt`) on most endpoints, with deliberate overrides where a different default is more useful (e.g., workflow tasks: `-priority,dueDate`).

## Non-goals

- **Sort on computed or aggregate fields.** Only persisted properties of the resource are sortable. Derived values like `daysUntilSlaBreach` or `totalHouseholdIncome` are not in scope. States that need them add a denormalized field via overlay.
- **Cursor-based pagination.** Sort order is independent of pagination strategy. Replacing offset-based pagination with cursors is a separate change.
- **Case-insensitive sort.** String sorts use SQLite's default collation, which is case-sensitive. Endpoints that need case-insensitive sorting on a field add a separate normalized sort key (e.g., `lastNameLower`) as part of their schema.
- **Locale-aware collation.** Spanish accent ordering, Turkish dotless-i collation, and similar locale rules are out of scope. Sorts use byte-order comparison.
- **Compile-time type safety in generated clients.** The `sort` parameter is typed as `string`. Custom codegen plugins to produce literal-union types from `x-sortable.fields` are explicitly deferred.
- **Configurable max-field limits per endpoint.** No hard limit on the number of sort fields a client may send. The pattern doc continues to recommend 3 or fewer; states that need stricter enforcement add it in their adapter layer.

## Edge cases

- **Null values in a sort field.** Records with `null` in a sort field sort consistently at one end of the order. Mock server behavior MUST be deterministic (e.g., always last in ascending, always first in descending) and documented in the pattern.
- **Empty x-sortable.fields array.** A list endpoint that declares `x-sortable.fields: []` is treated the same as no declaration: any `sort` query parameter is rejected with `INVALID_SORT_FIELD`.
- **Same field appearing multiple times in sort.** `?sort=-priority,priority` is rejected as `INVALID_SORT_FIELD` (the second occurrence is the duplicate). The parser MUST detect duplicates regardless of direction prefix.
- **Whitespace in sort values.** Leading/trailing whitespace in `?sort= priority , -dueDate ` MUST be trimmed per field, not rejected. Internal whitespace in a field name (e.g., `priority desc`) is rejected as `INVALID_SORT_FIELD`.
- **Sort field that exists on the schema but not in x-sortable.fields.** Distinguishable error: `FIELD_NOT_SORTABLE` (the field is real but not authorized for sort), not `INVALID_SORT_FIELD` (the field doesn't exist on the schema at all).
- **Nested field where the parent path is null on some records.** Mock server handles missing intermediate keys via SQLite's `json_extract` returning null; those records sort at the null end of the order.
- **x-sortable.default that conflicts with x-sortable.fields.** Caught by the spec linter at validate time, not at runtime — the spec is invalid and CI fails.

## Blueprint touchpoints

This work modifies the blueprint itself (it's a cross-cutting capability), so its "touchpoints" are conventions and components rather than specific domains:

### Patterns and components
- `api-patterns.yaml#sorting` — promoted from documented-but-unimplemented to documented-and-implemented
- `components/parameters.yaml` — gains the `SortParam` component
- `x-sortable.fields`, `x-sortable.default` — two new OpenAPI extensions on list operations

### Domains affected by migration
- workflow, intake, data-exchange, client-management, scheduling, document-management, identity-access — each list endpoint declares `x-sortable.fields` and `x-sortable.default`

## Blueprint gaps

This work _is_ a blueprint change. The gaps it closes:

- **`SortParam` component** — to be added to `packages/contracts/components/parameters.yaml`. Defines the `sort` query parameter as `name: sort, in: query, schema: type: string` with a description referencing the syntax from `api-patterns.yaml`.
- **`x-sortable` extension** — new OpenAPI extension on list operations, with `fields` (required), `default` (optional), `tieBreaker` (optional, defaults to `id`), and `maxFields` (optional). Validated by `validate-patterns.js`. Documented in `docs/architecture/x-extensions.md`.
- **Pattern doc update** — `api-patterns.yaml#sorting` removes the `STATUS: Not yet implemented` annotation and gains an `implementation` block describing the `x-sortable` extension shape, null-value ordering, and the no-declaration-means-rejected rule.
- **Adapter implementer's guide** — `docs/guides/` should gain a brief note describing how an adapter (mock server, state implementation, etc.) is expected to honor `x-sortable`: declared `fields` are sortable, `default` applies when `sort` is omitted, `tieBreaker` is always appended, `maxFields` rejects oversized inputs. This makes the contract-driven behavior explicit for downstream implementers.

## Open questions

- **Should nested-field sortability be flagged when the nested field belongs to a `oneOf` or `anyOf` variant?** A record may or may not have `citizenshipInfo.documentType` depending on `citizenshipInfo.status`. Sorting on `citizenshipInfo.documentType` would group all records-without-the-field at one end. Probably acceptable but worth a moment's thought.
- **Do generated TypeScript clients need a typed helper?** Spec currently picks pass-through string. If teams hit ergonomics issues, a typed `buildSort()` helper could be added in a follow-up without breaking the contract.
- **`tieBreaker: null` semantics.** Spec allows explicit `null` to disable the tie-breaker. Worth confirming whether disabling tie-breakers is ever actually useful, or whether it's better to require some tie-breaker on every sortable endpoint.
