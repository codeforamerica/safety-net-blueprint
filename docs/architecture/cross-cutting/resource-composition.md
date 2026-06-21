# Resource Composition

This document is the architecture reference for the resource composition pattern — the mechanism for declaratively defining composite views and associated composition-owned state resources across all Safety Net Blueprint domains. It covers the composition config format, assembly behavior, write path and links, field selection, filters, named views, derived fields, fragments, the `sectionView` composite type, composition state management, and overlay extensibility. The design draws from GraphQL's type system and the Backend-for-Frontend (BFF) deployment pattern, applied server-side at config time.

## Overview

When the front end needs data from multiple resources, the conventional alternatives are: write a one-off assembly handler for each consumer, build and maintain a BFF service per consumer, or delegate assembly to the client through multiple API calls. The composition pattern is a fourth option — a declarative config that a generic runtime executes to assemble and return a purpose-built response, without bespoke code per consumer.

The design applies GraphQL's core idea server-side: a generic runtime executes against a schema declaration rather than a hand-written handler per query. Where GraphQL gives clients flexibility to declare their queries at request time, this pattern fixes the assembly in config at design time — states declare what each screen or export needs, and the runtime assembles it. The result is the BFF outcome (one tailored response per consumer) without a BFF service to build or maintain.

The machine-readable structure also enables front-end integration. A `sectionView` composition's section index, panel data, and embedded write-path links give a client (or a forms engine like FormIO or Salesforce Screen Flow) everything it needs to enumerate steps, pre-populate each one, and route edits — without any of that being hand-wired per screen.

The three components of the pattern:

1. **Composition config** (`*-compositions.yaml`) — the single source of truth for a composite view. Declares the composite type, which resources are assembled and how they are bound and filtered, which fields are included, where state is tracked, and what endpoint the composite is served at. The composite type (`sectionView` or plain) determines the endpoint structure and assembly behavior.
2. **Resolve pipeline** — reads composition configs at build time and generates an OpenAPI overlay adding all declared and derived endpoints to the spec, including composition state endpoints generated from `state:` declarations. Also injects `_links` into parent resource response schemas when `parentLink: true` is set.
3. **Assembly runtime** — a generic engine that executes the resource queries declared in the config and returns the assembled response at request time. The mock server is the reference implementation; production adopters provide their own.

## Composition config

Each domain that uses compositions declares them in a `{domain}-compositions.yaml` file alongside its OpenAPI spec. The resolve pipeline discovers all `*-compositions.yaml` files automatically.

Top-level structure:

```yaml
$schema: "./schemas/compositions-schema.yaml"
version: "1.0"
domain: {domain}

compositions:  # required — named composition definitions
```

A composition definition:

```yaml
compositions:
  {compositionId}:
    compositeType: sectionView     # optional; omit for a plain composition
    resource: {resource-name}      # required; collection → array, singleton → object
    bind: {fieldName}              # optional; field on child matching parent ID; list for compound joins
    filter: "..."                  # optional; CEL expression, always applied
    fields: [field, field as alias]  # optional; field projection; omit for all fields
    flatten: true                  # optional; default false; promotes fields to parent level
    links: true                    # optional; default false; generates _links.self per item
    missing: empty                 # optional; singleton only; returns {} instead of null when not found
    include:                       # optional; nested resource queries included in the response
      {key}:
        resource: ...              # supports bind, filter, fields, flatten, links, missing, include
        bind: ...
    derives:                       # optional; domain-scoped expressions (see Derived fields)
    endpoint:                      # required for consumer-facing compositions
      path: /applications/{applicationId}/{compositionId}
      methods: [get]               # optional; default [get]
      parentLink: true             # optional; default false
    state:                         # optional; generates composition state endpoints
      schema: { $ref: './{domain}-compositions-schemas.yaml#/$defs/{SchemaName}' }
      methods: [put, patch]        # optional; default [put, patch]; GET always included
      flatten: true                # optional; default false
```

## Resource binding and assembly

Resource binding connects a child resource to its parent context. The `bind:` field names a field on the child resource that matches the parent's ID. The value resolves from the **bind context** — a scope chain that grows as the assembly tree deepens:

- Root level: URL path parameters and auth context (`$auth.userId`)
- Nested `include:` nodes: parent resource fields plus all inherited context from above

For compound joins (e.g., a resource keyed by both `memberId` and `programId`), `bind` accepts a list of field names:

```yaml
include:
  benefits:
    resource: member-benefits
    bind: [memberId, programId]
```

Auth-scoped bindings use `$auth.*` references:

```yaml
bind: $auth.userId
```

Query parameters are not bind sources — use `filter:` for conditional logic.

**Collection vs singleton inference** — consistent with GraphQL's type system: a resource with a collection endpoint returns an array; a resource with a singleton endpoint returns an object. The distinction is inferred from the resource definition, not declared.

**Missing records** — collections return `[]` by default when no records match. Singletons return `null` by default; `missing: empty` returns `{}` instead. Applies at any node level.

## Field selection

`fields:` is an optional list of field names from the source resource. Omitting it includes all fields — equivalent to GraphQL's `fields: [*]`, which is also accepted explicitly.

Fields support aliasing for cases where the target consumer expects a specific name or where flattening would produce a conflict:

```yaml
fields: [firstName, applicationId as clientApplicationId]
```

Field names are validated against the source resource schema at resolve time. Applies at any node level independently.

**Exception — `sectionView` index:** The index applies a different default: sections without `index:` appear as link-only entries. See [sectionView](#sectionview).

## Filters

CEL expressions on `filter:` are evaluated per item at read time. Filters are read-only — they do not constrain writes or affect generated link URLs. Multiple filters compose: a node's `filter:` and a named view's `filter:` both apply (AND semantics).

```yaml
filter: "status == 'active' && roles.contains('primary_applicant')"
```

The same resource can back multiple named compositions with different filters (e.g., `earned` and `unearned` both backed by `member-incomes`).

## Flatten

`flatten: true` removes the composition key from the output and promotes the node's fields to the parent level.

For singleton resources, the object's fields are spread into the parent. For collection resources, the first matching item is spread; `bind` or `filter` is required when flattening a collection.

```yaml
# Config
include:
  primaryAddress:
    resource: application-addresses
    bind: applicationId
    filter: "type == 'primary'"
    flatten: true
    fields: [street, city, state, zip]
```

```json
// Output — street/city/state/zip promoted to root level, no 'primaryAddress' wrapper
{
  "id": "app-123",
  "street": "123 Main St",
  "city": "Springfield"
}
```

`flatten` is mutually exclusive with `links` — a flattened node has no wrapper key to attach links to.

## Write path and links

`links: true` on a node generates `_links.self` on each item using the URL from the resource's spec-declared endpoint. For nested collection includes, `links: true` wraps the array as `{ items: [...], _links: { self: "collection-url" } }`, providing both item-level and collection-level URLs.

`links: true` is validated at resolve time against the resource's spec-declared GET endpoint. `links` does not cascade — each node opts in independently.

`parentLink: true` on an `endpoint:` declaration is distinct from node-level `links: true`. It injects `_links.{compositionId}` into the **parent resource's** GET by ID response — making the composition discoverable from the parent record. The corresponding `_links` property is added to the parent resource's response schema at resolve time.

```json
// GET /applications/{id}
{
  "id": "...",
  "_links": {
    "applicationReview": "/applications/abc-123/review"
  }
}
```

## Search and filtering

Composition panel and index endpoints support the same search, pagination, and sort params as other list endpoints in the blueprint. The specific params depend on the state's configured search capability — see the [Search and Filtering Pattern ADR](../../decisions/search-patterns.md) for the baseline approach.

Runtime filtering (e.g. "items where a field matches a value") is expressed through these params. Annotation-based filtering (e.g. "elements relevant to a given program") is a client-side concern — see the [Contract Metadata](contract-metadata.md) architecture doc.

Composition nodes support `filter:` expressions for structural assembly rules: conditions that always apply regardless of how the endpoint is queried (e.g. "only primary applicants", "only records matching this section"). These are distinct from runtime search — they are not exposed as query parameters and cannot be overridden by callers. See [Filters](#filters).

## Derived fields

Derived fields add computed values to assembly output without a separate resource or state machine step. They are declared in the composition config and evaluated at read time.

```yaml
derives:
  memberComplete: "has(firstName) && has(lastName) && has(dateOfBirth)"
  collectionHasData: "items.size() > 0"

compositions:
  memberSummary:
    resource: application-members
    bind: applicationId
    derive:
      complete: { $ref: '#/derives/memberComplete' }  # reuse from derives map
      hasData: "items.size() > 0"                     # inline expression
```

**Scope inference** — the runtime determines evaluation scope from the expression:
- Expression references `items` → **collection scope**: evaluated once against the full item array; result is a top-level field on the assembled response
- Expression does not reference `items` → **item scope**: evaluated per item; result added as a new field on each item

Expressions use the same CEL syntax as state machine conditions. Cross-domain reuse is supported via a root-level shared file (`packages/contracts/derives.yaml`), referenced with a relative path: `$ref: './derives.yaml#/memberComplete'`. Derived fields are runtime-only and are not emitted into the static OpenAPI schema.

## Composition state

A composition can declare an owned `state:` resource that the framework creates, persists, and exposes as a first-class resource with generated endpoints and schemas.

**Schema.** `schema:` points to the client-writable fields via `$ref` to the companion `{domain}-compositions-schemas.yaml` file. The framework adds the following fields automatically:

- `id` (UUID) — system-generated
- `createdAt`, `updatedAt` — standard timestamps
- Key fields from bind context: URL path parameters; `section` in a `sectionView`; the section item's ID (e.g., `memberId`) for collection-backed sections

Declaring any framework-added fields in the companion schema is a validation error.

**Naming.** The resource name is derived from the `$defs` key in the companion schema: PascalCase → camelCase response key → kebab-case path segment. `ReviewProgress` → `reviewProgress` → `review-progress`.

**Generated endpoints.** Path is derived from the parent resource path plus the kebab-case resource name. For a `sectionView` state, the section is also part of the path. When the section resource is a collection, the item's ID is appended — one record per item:

```
GET|PUT|PATCH /applications/{applicationId}/review-progress/{section}
GET|PUT|PATCH /applications/{applicationId}/review-progress/{section}/{memberId}
```

GET always returns current state, using JSON Schema `default` values for unwritten fields. PUT replaces the full writable state; PATCH updates individual fields. POST and DELETE are not supported — the framework manages the record lifecycle.

For `sectionView` compositions, the cross-section collection endpoint is intentionally not generated — state is accessed per section, not as a cross-section aggregate.

**Placement.** `state:` may appear at composition root level or, within a `sectionView`, at section level (applying only to that section). For `sectionView` compositions, granularity is auto-inferred: singleton-backed sections get one state record per section; collection-backed sections get one record per item.

**State machines.** A state machine can govern a `state:` resource following the same convention as other resources.

**State initialization.** Who creates initial state records is a domain concern configured in the state machine, not something the composition framework handles automatically.

## sectionView

The `sectionView` composite type models the named-section navigation pattern: a set of named sections accessible at an index endpoint, each individually addressable at a derived panel endpoint. Each section is backed by a different resource type — designed for heterogeneous content organized into named views (e.g., identity, income, household on a caseworker review screen).

```yaml
compositions:
  applicationReview:
    compositeType: sectionView
    resource: applications
    endpoint:
      path: /applications/{applicationId}/review
      parentLink: true
    state:
      schema: { $ref: './schemas/intake-compositions-schemas.yaml#/$defs/ReviewProgress' }
      methods: [put, patch]
    sections:
      identity:
        resource: members
        bind: applicationId
        index:
          filter: "roles.contains('primary_applicant')"
          fields: [name, dateOfBirth]
      household:
        resource: household-info
        bind: applicationId
      income:
        resource: members
        bind: applicationId
        index:
          fields: [*]
    panel:
      include:
        verifications:
          resource: verifications
          bind: applicationId
          filter: "category == $section.name"
```

**Section index** (`GET /applications/{applicationId}/review`)

The index is a navigation surface — sections default to link-only (`{ name, href }`), the opposite of the all-fields default for plain compositions and panels. `index:` opts into embedded data per section: `index: { fields: [...] }` embeds those fields; `index: { fields: [*] }` embeds all fields. The `href` pointing to the panel endpoint is always included, generated automatically from the endpoint path and section name.

**Panel** (`GET /applications/{applicationId}/review/{sectionName}`)

Field and link defaults match plain compositions: all fields unless `fields:` is declared on the section, no links unless `links: true` is set. Path is derived: `{endpoint.path}/{$section.name}` — not declared separately. Assembles the matching section's resource plus everything in `panel.include:`. `$section.name` in filters resolves to the path parameter value. The section's `state:` fields are included automatically.

**Enum byproduct.** Section keys in `sections:` generate a named enum type at resolve time, emitted into the companion schemas file. The name is derived from the composition key: PascalCase + `Sections` suffix (`applicationReview` → `ApplicationReviewSections`). This eliminates manually maintained enums whose valid values are defined by the composition's section structure.

## Overlay extensibility

States extend composition configs by placing an overlay file at `overlays/{state}/{domain}-compositions.yaml`. The resolve pipeline discovers these files alongside the base composition config and applies them automatically — no configuration needed.

Overlay files use the standard `overlay: 1.0.0` header and the same JSONPath-targeted action format as OpenAPI overlays:

```yaml
# overlays/california/intake-compositions.yaml
overlay: 1.0.0
info:
  title: California intake composition overlay
  version: 1.0.0
actions:
  - target: $.compositions.fosterCareHistory
    description: Add a California-specific foster care history composition
    add:
      resource: foster-care-records
      bind: applicationId
      endpoint:
        path: /applications/{applicationId}/foster-care-history
      fields: [id, memberId, status, placementDate, exitReason]
```

Use `add:` for any new key — it creates only if absent and warns rather than silently overwrites. Use `update:` to merge into an existing node. Use `remove:` to drop a baseline element that does not apply.

Overlay `add:` values can reference external files via `$ref` — useful when a state-specific composition is large enough to warrant its own file rather than being inlined in the overlay:

```yaml
actions:
  - target: $.compositions.fosterCareHistory
    add:
      $ref: './compositions/foster-care-history.yaml'
```

`add:` creates a key only if absent and warns rather than silently overwrites. Common targets in a composition file:

| What to add | Target path |
|---|---|
| New composition | `$.compositions.{name}` |
| Section in a sectionView | `$.compositions.{name}.sections.{sectionName}` |
| Include node in a composition | `$.compositions.{name}.include.{key}` |
| Include node in a panel | `$.compositions.{name}.panel.include.{key}` |
| Named view | `$.compositions.{name}.views.{viewName}` |

See the [Overlay Guide](../../guides/overlay-guide.md#add-a-new-key) for the full `add:` reference.

For `sectionView` compositions, each new section added via overlay automatically appears in the section index, is individually addressable at the derived panel path, and its key is added to the generated enum.

See the [Overlay Guide](../../guides/overlay-guide.md#composition-overlays) for a full example and the `add:` operation reference.

## Artifact locations

| Artifact | Location |
|---|---|
| Domain composition configs | `packages/contracts/{domain}-compositions.yaml` |
| Composition state schemas | `packages/contracts/schemas/{domain}-compositions-schemas.yaml` |
| Compositions config schema (JSON Schema for the config format) | `packages/contracts/schemas/compositions-schema.yaml` |
| Shared derived expressions | `packages/contracts/derives.yaml` |
| State machines for `state:` resources | `packages/contracts/{domain}-state-machine.yaml` |

## Key design decisions

| # | Decision | Summary |
|---|---|---|
| 1 | [Declarative config over hand-authored endpoints](#decision-1-declarative-config-over-hand-authored-endpoints) | A generic runtime executing against config — the GraphQL model applied server-side — replaces per-consumer endpoint code and eliminates BFF proliferation. |
| 2 | [Hypermedia links in composition responses](#decision-2-hypermedia-links-in-composition-responses) | First use of `_links` in the blueprint — composition responses surface write paths to assembled sub-resources, opt-in per node. |
| 3 | [compositeType as a named discriminant](#decision-3-compositetype-as-a-named-discriminant) | Explicit `compositeType` field selects assembly behavior rather than inferring it from config shape. |
| 4 | [sectionView: navigation index with derived panels](#decision-4-sectionview-navigation-index-with-derived-panels) | Section index defaults to link-only — a navigation surface — with panel paths derived from section keys. |
| 5 | [Composition-owned state](#decision-5-composition-owned-state) | State resources tracking composition-level progress are declared within the composition config and generated alongside the composite endpoints. |
| 6 | [Section keys as URL path segments](#decision-6-section-keys-as-url-path-segments) | Panel paths are derived from section key names; no separate path declaration per section. |
| 7 | [Runtime filtering via standard search params](#decision-7-runtime-filtering-via-standard-search-params) | Composition endpoints support the state's configured search, pagination, and sort params — consistent with other list endpoints. |
| 8 | [parentLink for composition discovery](#decision-8-parentlink-for-composition-discovery) | `_links.<compositionId>` injected into parent resource responses — clients navigate via links rather than hardcoding paths. |

---

### Decision 1: Declarative config over hand-authored endpoints

**Status:** Decided: B

**What's being decided:** Whether composite views are defined as hand-authored OpenAPI paths and per-consumer assembly handlers, or as declarative YAML configs executed by a generic runtime.

**Background:** The original review-context endpoint was hand-authored: the OpenAPI path was written directly in `intake-openapi.yaml`, and the mock server had a dedicated handler that queried each sub-resource manually. Three artifacts — the OpenAPI path, the server handler, and the integration tests — had to be updated in lock-step whenever the composite changed. Every new composite view required the same three-artifact work. Salesforce and ServiceNow both use configuration-driven composite assembly in their case management products rather than per-view handler code; the blueprint's hand-authored approach had no equivalent scaling path.

**Considerations:**
- Hand-authored endpoints are explicit and self-contained: a reader sees exactly what the endpoint does without understanding a framework.
- Declarative config collapses the three synchronized artifacts into one source of truth. When a section is added, the spec overlay, runtime assembly, and write-path links update together from the same change.
- A standalone BFF service achieves the same consumer-tailoring goal but requires its own contract, its own deployment surface, and ongoing maintenance independent of the underlying domain contracts — compounding drift risk rather than eliminating it.
- The design explicitly applies GraphQL's core idea: a generic runtime executes against a schema declaration rather than bespoke code per consumer. Unlike GraphQL, the declaration is fixed in config at design time rather than client-driven at query time — states control what each consumer receives.

**Options:**
- **(A)** Hand-authored — explicit; no framework; three synchronized artifacts per composite; each new screen requires development work
- **(B) ✓** Declarative config — single source of truth; generic runtime generates the OpenAPI overlay and assembles responses; new views are config changes, not development projects

**Decision:** Declarative (B). The drift risk between spec and handler is structural under option A; the BFF alternative trades that risk for service proliferation.

---

### Decision 2: Hypermedia links in composition responses

**Status:** Decided: B

**What's being decided:** Whether composition responses should include `_links` pointing to write paths for the underlying sub-resources — the first use of hypermedia links in the blueprint.

**Background:** Prior to the composition pattern, no API in the blueprint returned `_links`. Composition responses assemble data from multiple sub-resources, each with its own independent write endpoints. Without surfacing those endpoints in the response, consumers must know or hardcode write URLs — meaning the composition alone is not a sufficient interface contract for its consumers. A client needs to know where to submit edits for each assembled resource without that knowledge being hand-wired in.

**Considerations:**
- The composition config already knows every sub-resource and its spec-declared endpoint. Generating links from that config costs nothing and makes the composition self-describing.
- Introducing links in composition responses keeps the scope narrow: links appear where they add clear structural value — a composite that assembles multiple independent write surfaces — rather than as a global convention applied everywhere.
- A front end consuming a `sectionView` composition's index and panel responses can enumerate steps, pre-populate fields, and route edits entirely from those responses without any additional path knowledge.
- RFC 5988 / HAL conventions are established in commercial case management APIs (Salesforce, ServiceNow) and REST best practices. `links: true` is opt-in per node, not a global default.

**Options:**
- **(A)** No links — clients know write paths from the spec or hardcode them; composition responses are read-only views
- **(B) ✓** `links: true` on nodes generates `_links.self` per item — composition responses include the write paths for each assembled resource; opt-in per node

**Decision:** Include links (B). The composition is the right place to introduce links because it is the first surface where a single response assembles multiple heterogeneous write paths.

---

### Decision 3: compositeType as a named discriminant

**Status:** Decided: B

**What's being decided:** Whether the composition config should use an explicit `compositeType` field to select assembly behavior, or whether different behaviors should be inferred from config shape.

**Background:** The composition pattern supports two assembly behaviors: a plain composition returning assembled resource data at a single endpoint, and `sectionView` generating an index plus per-section panel endpoints. These require different OpenAPI generation and assembly logic.

**Considerations:**
- Inference from config shape is fragile: any heuristic (e.g., "has `sections:`") becomes a constraint on future config evolution. A new composite type would require a new inference rule with risk of ambiguity.
- An explicit `compositeType` field is self-documenting and extensible: new types can be added without touching inference logic.
- Omitting `compositeType` for plain compositions avoids noise in the simpler case — plain is the default.

**Options:**
- **(A)** Infer from config shape — no explicit type field; simpler for simple configs; fragile as the schema evolves
- **(B) ✓** Explicit `compositeType` field — `compositeType: sectionView` for sectionView; omit for plain; extensible, no inference ambiguity

**Decision:** Explicit discriminant (B). Inference is fragile and limits extensibility.

---

### Decision 4: sectionView as a first-class composite type

**Status:** Decided: B

**What's being decided:** Whether the named-section navigation pattern — a set of heterogeneous, independently addressable sections accessible via an index — should be a first-class composite type with generated structure, or assembled manually from plain compositions.

**Background:** Benefits review workflows, interview flows, and multi-step case management screens share a common structure: a parent record (an application, a case) has several named sections, each backed by a different resource type, each individually addressable. Without a first-class type for this pattern, every domain implementing it would need to hand-assemble the section navigation from plain compositions — manually declaring a section index endpoint, per-section endpoints, a section enum, and section-scoped state paths.

**Considerations:**
- A plain composition assembles resources but has no concept of named sections. Implementing a section navigation surface from plain compositions requires the consuming client to invent and maintain the section structure — it cannot be read from the API.
- Carving out `sectionView` as a named type lets the framework generate the full section contract from a single config: section index, per-section panel paths, a generated sections enum, and section-scoped state endpoints. Adding a section in config is sufficient — no additional endpoint declarations, no enum update, no state path wiring.
- The named-section pattern is common across case management vendors: ServiceNow's tabbed workspaces, Salesforce's multi-step Screen Flows, IBM Curam's section-based evidence pages all express a structurally similar concept. Making it a first-class type positions the blueprint's API surface to be legible to implementors familiar with those platforms.
- Making it a type also makes the section structure machine-readable and discoverable from the API — clients read the section index to understand what sections exist and where they live, rather than relying on out-of-band documentation.

**Options:**
- **(A)** Manual assembly from plain compositions — maximum flexibility; no framework support; each domain reimplements section navigation; section structure not discoverable from the API
- **(B) ✓** `sectionView` as a named composite type — section index, panel paths, sections enum, and state endpoints generated from config; section structure machine-readable and API-discoverable

**Decision:** First-class type (B). The pattern is common enough across domains and vendors to warrant framework support. Generated structure eliminates per-domain reimplementation and makes section contracts machine-readable.

---

### Decision 5: Composition-owned state

**Status:** Decided: B

**What's being decided:** Whether state resources that track composition-level progress should be declared within the composition config and generated alongside the composite endpoints, or defined as independent resources in the OpenAPI spec.

**Background:** Review workflows require per-section state tracking — which sections are complete, notes, flags. The original approach was a standalone CRUD resource with hand-authored paths, schema, and handlers. Its relationship to the composition's section structure was enforced by convention only: a client could write a state record for a section that did not exist in the composite.

**Considerations:**
- Declaring state within the composition ties its lifecycle to the composition's structure: adding a section automatically makes state endpoints available for that section; the generated URL structure enforces that state is only accessible per section, preventing orphaned records.
- Independent CRUD resources are more flexible — any client can write to them, relationships by convention, cross-section aggregation possible.
- Co-locating state ensures the composition is a complete interface contract: read paths, write paths, and state tracking all from one config.

**Options:**
- **(A)** Independent CRUD resource — flexible; independently evolvable; section relationship by convention
- **(B) ✓** Declared in composition config — section structure enforced by generated URLs; state co-located with composite; cross-section aggregation not generated

**Decision:** Composition-owned (B). The generated URL structure enforces the compositional relationship; co-location ensures they evolve together.

---

### Decision 6: Section keys as URL path segments

**Status:** Decided: B

**What's being decided:** Whether panel endpoint paths should be derived automatically from section keys, or declared explicitly in each section definition.

**Background:** A sectionView composition has N sections, each needing a panel endpoint. Each could declare its own `path:` or have it derived from its config key.

**Considerations:**
- Using the section key as the URL segment makes section names part of the API surface — a deliberate choice that keeps the config and URL contract unified. A section named `identity` in config is at `/review/identity` in the API; renaming it changes both together.
- Auto-derivation removes N redundant declarations. Explicit declarations would allow key and URL to diverge — creating a maintenance surface where they drift independently.
- Once section names are URL-visible, they appear consistently across the full section contract: panel paths, state endpoint paths, the generated sections enum, and filter contexts (`$section.name`). Explicit path declarations would break that consistency.

**Options:**
- **(A)** Explicit `path:` per section — key and URL can diverge; redundant declarations for the common case; section names not necessarily URL-visible
- **(B) ✓** Derived from section key — section names become the URL segment; config and URL stay unified; no extra declarations

**Decision:** Auto-derived (B). Making section names the URL segment is a deliberate choice to keep the section contract unified — config key, panel path, state path, and enum all use the same name.

---

### Decision 7: Runtime filtering via standard search params

**Status:** Decided: B

**What's being decided:** Whether composition panel and index endpoints support runtime filtering and search, and if so, how.

**Considerations:**
- Panel endpoints return assembled item lists — structurally the same shape as other list endpoints in the blueprint. Consistency means supporting the same search, pagination, and sort params.
- Instance-level filtering (e.g. "items where a field matches a value") depends on resource state at request time. The blueprint's search param expresses this naturally and is already understood by states that configure a search backend.
- Annotation-based filtering (e.g. program relevance) is a client-side concern — see the [Contract Metadata](contract-metadata.md) architecture doc.
- Panel endpoints span assembled fields from potentially multiple resources. States configuring a search backend for composition endpoints need to handle indexing across the assembled field set.
- Composition nodes support structural `filter:` expressions for assembly rules that always apply regardless of how the endpoint is queried. These are not exposed as query parameters and are distinct from runtime search.

**Options:**
- **(A)** No search params — composition endpoints are fixed, unfiltered reads
- **(B) ✓** Standard search, pagination, and sort params — consistent with all other list endpoints; search capability is state-configured

**Decision:** B. Consistency with list endpoints; states already configure a search backend for their resource endpoints.

---

### Decision 8: parentLink for composition discovery

**Status:** Decided: B

**What's being decided:** How API consumers discover that a parent resource has an associated composite view, without needing out-of-band knowledge of endpoint paths.

**Considerations:**
- Hardcoded paths in clients create maintenance overhead when endpoint paths change and are not visible in the API response itself.
- `_links` follows the RFC 5988 hypermedia convention used by HAL and JSON:API. Salesforce and ServiceNow REST APIs both return related resource links in their responses, enabling clients to navigate relationships without hardcoded path knowledge.
- `parentLink: true` is opt-in per composition — not all composites need to surface links on the parent resource.

**Options:**
- **(A)** Document paths in the API reference only — no runtime discoverability; clients hardcode paths; path changes require client updates
- **(B) ✓** `parentLink: true` injects `_links.<compositionId>` — discoverable from the parent resource GET response; path changes transparent to clients navigating via links

---

## References

- [Composition config schema](../../../packages/contracts/schemas/compositions-schema.yaml)
- [Intake composition config](../../../packages/contracts/intake-compositions.yaml)
- [Intake composition state schemas](../../../packages/contracts/schemas/intake-compositions-schemas.yaml)
- [Resolve Pipeline Architecture](../resolve-pipeline.md)
- [Behavioral Contract DSL](behavioral-contract-dsl.md)
- [Intake Domain](../domains/intake.md)
