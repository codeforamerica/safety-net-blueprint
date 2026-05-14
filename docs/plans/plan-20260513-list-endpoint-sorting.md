---
title: List endpoint sorting — implementation plan
status: draft
authors: [Leo Kacenjar]
approvers: []
categories: []
date: 2026-05-13
---

## Goal

Implement the documented `?sort=` query-parameter convention end-to-end: a single `x-sortable` extension on list operations, a pattern-validator that lints it, a mock-server parser that honors it with stable pagination, and migrated declarations on every existing list endpoint.

## Context

Based on the spec at `docs/specs/spec-20260512-list-endpoint-sorting.md` (issue #288). Decisions locked: single consolidated `x-sortable` extension (with `fields`, `default`, `tieBreaker`, `maxFields` sub-keys), per-resource defaults, contract-declared tie-breaker (defaults to `id`), no compile-time client typing.

This work _is_ the blueprint — no remote blueprint fetch applies (we're editing the source of truth). No local-vs-remote drift check needed.

Existing code shape this plan builds on:

- **`packages/contracts/components/parameters.yaml`** holds `SearchQueryParam`, `LimitParam`, `OffsetParam`. New `SortParam` lives next to them.
- **`packages/contracts/src/validation/pattern-validator.js`** (driven by `scripts/validate-patterns.js`) is the existing place to add the `x-sortable` schema check, the cross-reference validation against the response schema, and the lint rule requiring `SortParam` to appear in parameters when `x-sortable` is declared.
- **`packages/mock-server/src/search-engine.js`** owns the SQL builder. `executeSearch(db, queryParams, searchableFields, paginationDefaults)` currently hardcodes `ORDER BY COALESCE(json_extract(data, '$.createdAt'), '1970-01-01T00:00:00Z') DESC`. The new sort parser plugs in here. Callers (`handlers/list-handler.js`, `handlers/search-handler.js`) pass endpoint metadata down.
- **`packages/mock-server/src/handlers/list-handler.js`** is where endpoint metadata (including the new `x-sortable` config) gets read out of the loaded spec and passed to `executeSearch`. Route registration in `route-generator.js` already extracts `searchableFields`; we extend the same path for `sortConfig`.
- **Tests** use Node's native test runner (`node --test`). Unit tests live in `packages/mock-server/tests/unit/` and `packages/contracts/tests/unit/`. Integration tests in `packages/mock-server/tests/integration/`. Existing patterns: `search-engine.test.js`, `search-engine-conditions.test.js`, `query-parser.test.js`. New sort parser tests follow the same shape.

No `/write-*` language skills present in this project's `skills/` tree (none referenced from CLAUDE.md). CLAUDE.md conventions apply: smallest reasonable changes, match surrounding style, no ESLint/Prettier, Spectral handles OpenAPI linting.

## Approach

### Single extension shape

Each list operation that supports sorting declares one extension key:

```yaml
x-sortable:
  fields: [createdAt, priority, dueDate]
  default: -priority,dueDate    # optional
  tieBreaker: id                 # optional, defaults to id
  maxFields: 3                   # optional, no limit if absent
```

The validator is the single point of truth for what's well-formed; the mock server is the single point of truth for runtime behavior. A `SortParam` component in `components/parameters.yaml` is referenced from every sort-enabled list operation; specs that declare `x-sortable` without referencing `SortParam` fail validation.

### Sort parsing module

A new `packages/mock-server/src/sort-parser.js` module exports two pure functions:

1. `parseSortString(raw, sortConfig)` — tokenizes `?sort=-priority,dueDate`, validates each field against `sortConfig.fields`, enforces `maxFields` and duplicate-field detection. Returns `{ ok: true, fields: [{name, direction}] }` or `{ ok: false, code, message }` matching the documented error codes.
2. `buildOrderByClause(parsedFields, sortConfig)` — builds the SQL `ORDER BY` fragment, appending the configured `tieBreaker` (default `id`). Handles null-value ordering deterministically via `COALESCE` (nulls last in ascending, first in descending). Returns the SQL fragment as a string with no parameter substitution — field names are whitelist-validated, not parameterized (SQLite doesn't parameterize identifiers).

These are pure and don't import `database-manager` so they're unit-testable in isolation.

### Wiring through executeSearch

`executeSearch` gains an optional `sortConfig` parameter. When present:

- If `?sort=` is in `queryParams`, parse it with `parseSortString`. On parse failure, the function returns a sentinel that the list handler translates into a 400 with the documented error codes.
- If `?sort=` is absent and `sortConfig.default` is declared, parse the default the same way (it must validate, or the spec is invalid — caught at lint time).
- If `?sort=` is absent and `sortConfig.default` is absent, no client-driven sort; only the `tieBreaker` is applied.

When `sortConfig` is undefined (endpoint did not declare `x-sortable`), the current behavior is preserved for the absent-sort case (no implicit ORDER BY beyond what already exists), and any `?sort=` query param is rejected by the list handler with `INVALID_SORT_FIELD`.

### Why a consolidated extension over two correlated extensions

A single `x-sortable` namespace keeps related config in one place, lets us add `tieBreaker` and `maxFields` without spawning more `x-*` keys, and makes the validator's job clear: "this key requires `fields`, optionally accepts `default`/`tieBreaker`/`maxFields`, validates them as a group." Two separate extensions (`x-sortable-fields` + `x-default-sort`) would have required either correlation logic in the validator or implicit pairing rules.

### Why declare tie-breaker in the contract instead of hardcoding `id ASC` in the adapter

The blueprint's pattern is "contract is the source of truth, adapters implement what's declared." Hardcoding tie-breaker semantics in `search-engine.js` would be an implicit behavior that downstream adapter implementers (real production servers) might miss, get wrong, or override in incompatible ways. With `tieBreaker` in the contract, the behavior is reviewable, overlayable, and explicit. The cost is one optional field on every sort-enabled operation, which defaults to `id` (the universal resource identifier in this project), so most specs touch nothing.

### Why pass-through `string` typing on generated clients

Compile-time literal-union types for `sort` would require a codegen plugin or post-codegen transform on `@hey-api/openapi-ts` output. The cost is non-trivial; the benefit (catching `sort=-priorty` typos at compile time) is partial — the same typo on a multi-field sort string still works at the type level. Runtime errors flag invalid fields immediately at the API boundary, with the documented error codes. A typed `buildSort()` helper is a clean follow-up path if teams hit ergonomics issues.

## Phases

### Phase 1: Pattern documentation and `SortParam` component

Land the contract-side foundation so specs can start declaring `x-sortable` and reference a shared parameter component. No runtime behavior change yet.

- [x] Write a unit test asserting that `components/parameters.yaml` exports a `SortParam` schema matching the documented shape (name `sort`, in `query`, type string, optional)
- [x] Add the `SortParam` definition to `packages/contracts/components/parameters.yaml`
- [x] Update `packages/contracts/patterns/api-patterns.yaml#sorting` to remove the `STATUS: Not yet implemented` annotation; document the consolidated `x-sortable` shape (fields/default/tieBreaker/maxFields), the syntax (comma-separated, `-` prefix), the documented error codes, and the null-value ordering rule
- [x] Document the `x-sortable` extension in `docs/architecture/x-extensions.md` next to the other extensions
- [x] Add a brief "implementing the sort extension" note to `docs/guides/` aimed at downstream adapter implementers (one section, not a new file — append to the existing API guide). Include: (a) the identifier regex contract on field names, (b) the implicit `maxFields` ceiling adapters must apply when the spec omits it, (c) guidance that fields included in `x-sortable.fields` must be safe to leak via sort order — sort is an oracle (A01:2025), (d) failed parses should log the offending field name at info level (A09:2025)

### Phase 2: Pattern validator

The linter enforces the `x-sortable` shape and cross-references. CI fails on a misdeclared spec before any code runs.

- [x] Write a unit test in `packages/contracts/tests/unit/` (e.g., `validate-patterns-sortable.test.js`) asserting that a spec with valid `x-sortable` passes, and that each invalid case produces a clear error: missing `fields`, field not on response schema, `default` references a field absent from `fields`, `tieBreaker` not on response schema, `SortParam` not referenced when `x-sortable` is present
- [x] Write parameterized negative tests asserting that field names containing any of these are rejected at lint time: SQL metacharacters (`;`, `'`, `"`, backtick), JSON-path metacharacters (`[`, `]`, `\`), whitespace, control characters, non-ASCII, and Unicode RTL / zero-width characters — applies to entries in `fields`, `default`, and `tieBreaker` (A03:2025, A05:2025)
- [x] Extend `packages/contracts/src/validation/pattern-validator.js` to detect `x-sortable` on list operations and run the validations from the test, including the lexical identifier regex `^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$` on every field name (A03:2025)
- [x] Add a Spectral rule (or a check in pattern-validator) that warns when any field tagged `x-pii: true` or matching common sensitive-field name patterns (`ssn`, `dateOfBirth`, `riskScore`, etc.) appears in `x-sortable.fields` — sort order is an information-disclosure oracle (A01:2025)
- [x] Add a parameterized test covering nested-field dot-notation (`name.lastName`, `citizenshipInfo.status`) against the corresponding schemas; verify `$ref`/`allOf` traversal works
- [x] Wire the new validator into `scripts/validate-patterns.js` (it's already imported via `validateSpec` — confirm no script-side change is needed)

### Phase 3: Sort parser (pure module)

The parser is the only piece that decides what's well-formed at runtime. Keep it isolated and exhaustively unit-tested before it touches the search engine.

- [x] Write a unit test file `packages/mock-server/tests/unit/sort-parser.test.js` covering: single field asc, single field desc, multi-field, leading/trailing whitespace per field, duplicate-field detection regardless of direction prefix, unknown field, field-not-in-sortable-set, `maxFields` enforcement (when declared), empty input
- [x] Write negative tests asserting that even if `sortConfig.fields` somehow contains a malformed name (defense-in-depth — the linter should already have caught it), the parser rejects the request rather than passing it to SQL. Cover SQL metacharacters, JSON-path metacharacters, whitespace, and non-ASCII (A03:2025, A05:2025)
- [x] Write a test asserting that when a spec omits `maxFields`, the parser enforces an implicit ceiling (default: 5). Cover both the "below ceiling: pass" and "above ceiling: reject with the documented error code" cases (A04:2025, A10:2025)
- [x] Implement `packages/mock-server/src/sort-parser.js#parseSortString(raw, sortConfig)` returning the discriminated-union result shape from the test. Include the runtime identifier regex as a defense-in-depth check and the implicit `maxFields` ceiling
- [x] Write tests for `buildOrderByClause(parsedFields, sortConfig)` covering: ascending/descending direction translation, nested-field path → `json_extract(data, '$.path.to.field')`, null-value handling (nulls last asc, nulls first desc), tie-breaker appended unconditionally, `tieBreaker: null` skipped
- [x] Implement `buildOrderByClause` to pass. Document the function's invariant: "every field name passed here has already been validated against the lexical regex and the per-endpoint allowlist; this function performs no further validation and trusts its inputs" — so a bug elsewhere doesn't compromise the SQL safety (A03:2025)

### Phase 4: Mock server wiring

Plug the parser into `executeSearch` and propagate `sortConfig` from endpoint metadata through the list-handler.

- [x] Write an integration test in `packages/mock-server/tests/integration/` (or extend `integration.test.js`) for a list endpoint with `x-sortable` declared: single-field sort, multi-field sort, default applied when sort omitted, stable pagination across pages
- [x] Extend `executeSearch(db, queryParams, searchableFields, paginationDefaults, sortConfig)` in `search-engine.js` to honor `sortConfig` and replace the hardcoded `ORDER BY createdAt DESC` path
- [x] Update `handlers/list-handler.js` to pass `sortConfig` (extracted from the endpoint's `x-sortable` extension at route registration) into `executeSearch`, and translate parser errors into 400 responses with the documented error codes
- [x] Update `route-generator.js` to read `x-sortable` from each list operation and stash it on the endpoint metadata alongside `searchableFields` *(landed in `openapi-loader.js` — the endpoint object is constructed there and consumed by `route-generator.js` unchanged)*
- [x] Write a test confirming that a `?sort=` parameter sent to an endpoint without `x-sortable` returns 400 `INVALID_SORT_FIELD` (not silently ignored)

Tasks in this phase can be parallelized cautiously — the integration test author needs the route-generator change to land first, but the `executeSearch` and `list-handler` updates can proceed against the test fixture in parallel.

### Phase 5: Migrate baseline list endpoints

Apply `x-sortable` to every existing list endpoint that should support sorting. Each commit migrates one or two domains so the change set is reviewable.

- [ ] Write an integration test asserting that every list endpoint either declares `x-sortable` or returns a documented 400 on `?sort=` — i.e., no endpoint silently ignores the parameter (this catches regressions during migration and afterwards)
- [ ] Add `x-sortable` to `workflow-openapi.yaml` list endpoints (tasks, queues, metrics) with `tieBreaker: id` (default) and sensible per-endpoint defaults
- [ ] Add `x-sortable` to `intake-openapi.yaml` list endpoints (applications, members, documents)
- [ ] Add `x-sortable` to `data-exchange-openapi.yaml` (services, service-calls)
- [ ] Add `x-sortable` to `persons-openapi.yaml`, `households-openapi.yaml`, `incomes-openapi.yaml`, `case-management-openapi.yaml`, `scheduling-openapi.yaml`, `users-openapi.yaml`, `document-management-openapi.yaml`, `platform-openapi.yaml`
- [ ] As part of each domain migration, audit which fields are safe to declare in `x-sortable.fields` — exclude any field whose sort order would leak information (e.g., SSN, dateOfBirth, internal risk scores, sensitive flags). Sort order is an oracle (A01:2025)
- [ ] Regenerate contract tables (`npm run contract-tables:export`) and design reference (`npm run design:reference`); commit the updated artifacts so the CI freshness checks pass
- [ ] Run `npm run preflight` and address any spec lint failures the new validator surfaces

These domain-by-domain tasks are mechanical and can be done in parallel by multiple authors if needed.

### Phase 6: Verify generated clients

The TypeScript client generator should pick up the new `sort` parameter automatically. Confirm with a smoke test rather than a code change.

- [ ] Write a smoke test that runs `npm run clients:typescript -- --specs=./resolved --out=./tmp/sdk` against a resolved spec containing `x-sortable` and asserts that the generated list-operation type accepts a `sort?: string` parameter
- [ ] Document the pass-through typing decision (with the typed-helper deferred path) in the package's CHANGELOG entry for the next minor release

## Risks

- **SQL identifier validation** — field names come from user input via the `sort` query parameter and are interpolated into the `ORDER BY` clause (SQLite doesn't parameterize identifiers). The parser MUST validate every field name against `sortConfig.fields` _before_ any SQL construction, with no path that interpolates an unvalidated string. If the validation step is bypassed by a bug elsewhere, this becomes SQL injection. The test in Phase 3 must explicitly cover "unknown field → rejected before SQL is built." (A01:2025 — see security review notes.)
- **Nested-field path safety** — `name.lastName` becomes `json_extract(data, '$.name.lastName')`. The path segments themselves are validated against the schema, but if a future change allows arbitrary characters in field names (e.g., `name."lastName"` for SQLite quoted identifiers), escaping needs revisiting.
- **Migration scope creep** — Phase 5 touches every domain spec. If any spec has a list endpoint with unusual semantics (e.g., the search endpoint, which doesn't go through `executeSearch`), the migration needs an exception. Worth scoping out before kickoff.
- **Adapter-implementer guidance is the weakest deliverable** — Phase 1's brief note in the API guide is the only artifact pushing the contract-driven behavior down to real state implementations. A more thorough adapter guide would be a follow-up.
