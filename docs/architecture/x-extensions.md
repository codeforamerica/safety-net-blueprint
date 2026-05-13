# OpenAPI Extensions (x- Extensions)

All `x-` extensions used in Safety Net Blueprint contract artifacts, listed alphabetically.

The machine-readable catalog is in [`packages/contracts/patterns/api-patterns.yaml`](../../packages/contracts/patterns/api-patterns.yaml) under `x_extensions`.

---

## Summary

| Extension | File type(s) | Location within file |
|---|---|---|
| `x-domain` | `*-openapi.yaml` | `info` level or operation level |
| `x-environments` | Any spec node | `paths`, operations, schemas, or any other node |
| `x-events` | `*-openapi.yaml` | Top-level (peer to `info:`, `paths:`) |
| `x-enum-source` | `*-openapi.yaml` | Schema property (on string fields with contract-derived enum values) |
| `x-relationship` | `*-openapi.yaml` | Schema property (on FK fields ending in `Id`) |
| `x-sortable` | `*-openapi.yaml` | List operation level |
| `x-status` | `*-openapi.yaml` | `info` level or operation level |
| `x-visibility` | `*-openapi.yaml` | `info` level or operation level |

---

## x-domain

**File type:** `*-openapi.yaml` — `info` level (entire API) or operation level (multi-domain specs). Required on all API specs.

The business domain this API belongs to. Enables filtering, domain-specific documentation generation, and future folder reorganization without changing file locations.

```yaml
# workflow-openapi.yaml
info:
  title: Workflow Service API
  x-domain: workflow
```

Valid values: `case-management`, `client-management`, `communication`, `data-exchange`, `document-management`, `eligibility`, `identity-access`, `intake`, `platform`, `reporting`, `scheduling`, `search`, `workflow`.

---

## x-environments

**File type:** Any spec node — `paths`, operations, schemas, or any other YAML node.

Tags a spec section so the resolve pipeline includes it only in specific environments. When resolving with `--env=<name>`, nodes whose `x-environments` list does not include the target environment are removed. The `x-environments` key is stripped from nodes that are kept.

```yaml
paths:
  /debug/health:
    x-environments: [development, staging]
    get:
      summary: Health check (non-production only)
```

Without `--env`, all sections are included as-is regardless of `x-environments` annotations.

See [Resolve Pipeline Architecture](resolve-pipeline.md#5-environment-filtering) for how this is applied during the pipeline.

---

## x-events

**File type:** `*-openapi.yaml` — top-level (peer to `info:`, `paths:`).

Declares the domain events emitted by an API. Each key is an event name in dot notation (e.g., `task.created`). AsyncAPI specs and event documentation are generated from this section combined with the domain's state machine YAML.

APIs that emit no events should declare `x-events: {}` to make the intent explicit.

```yaml
# workflow-openapi.yaml
x-events:
  task.created:
    type: org.codeforamerica.safety-net-blueprint.workflow.task.created
    summary: Emitted when a task is first created
    payload:
      $ref: "#/components/schemas/TaskCreatedEvent"
```

---

## x-enum-source

**File type:** `*-openapi.yaml` — schema property level, on string fields whose valid values come from another contract artifact.

Declares that a field's enum values are derived from a behavioral contract (state machine, SLA types) rather than hardcoded in the OpenAPI spec. The value is a path expression into the source artifact. The resolve pipeline injects the actual enum values at build time, keeping the spec in sync without duplication.

```yaml
# workflow-openapi.yaml
status:
  type: string
  x-enum-source: states[].id
  description: Current lifecycle state. Valid values injected from workflow-state-machine.yaml.

# components/sla.yaml
slaTypeCode:
  type: string
  x-enum-source: slaTypes[].id
  description: Identifies which SLA type applies. Valid values injected from workflow-sla-types.yaml.
```

---

## x-relationship

**File type:** `*-openapi.yaml` — schema property level, on foreign-key fields.

Annotates a UUID foreign-key field to identify the related resource. Required on all fields that end in `Id` and have `format: uuid`. Enables tooling to generate relationship diagrams, validate referential integrity, and optionally expand related resources inline.

```yaml
# components/schemas/Task
queueId:
  type: string
  format: uuid
  description: Queue this task is routed to.
  x-relationship:
    resource: Queue        # Related schema name (PascalCase)
    style: expand          # Optional: inline the related resource instead of referencing by ID
```

**Fields:**

| Field | Required | Description |
|---|---|---|
| `resource` | Yes | Related schema name in PascalCase (e.g., `Queue`, `Person`) |
| `style` | No | `expand` causes the mock server to inline the related resource. Default: reference by ID. |

---

## x-sortable

**File type:** `*-openapi.yaml` — list operation level (alongside `parameters`, `responses`).

Declares which fields a list endpoint allows in the `?sort=` query parameter, the default sort to apply when the client omits it, the tie-breaker for stable pagination, and an optional cap on the number of fields a client may include.

```yaml
# workflow-openapi.yaml
paths:
  /tasks:
    get:
      operationId: listTasks
      x-sortable:
        fields: [createdAt, priority, dueDate, status]   # required
        default: -priority,dueDate                        # optional
        tieBreaker: id                                    # optional, defaults to id
        maxFields: 3                                      # optional, adapter applies implicit ceiling if absent
      parameters:
        - $ref: "./components/parameters.yaml#/SortParam"
        - $ref: "./components/parameters.yaml#/LimitParam"
        - $ref: "./components/parameters.yaml#/OffsetParam"
```

**Fields:**

| Field | Required | Description |
|---|---|---|
| `fields` | Yes | Array of field names a client may include in `?sort=`. Dot-notation for nested fields (e.g., `name.lastName`). Every entry must reference a real property on the resource's response schema. |
| `default` | No | Comma-separated sort applied when the client omits `?sort=`. Same syntax as the query parameter. Every field referenced here must appear in `fields`. If absent, no client-driven sort is applied when `?sort=` is omitted — only the tie-breaker. |
| `tieBreaker` | No | Single field name appended to every effective sort for stable pagination. Defaults to `id`. Explicit `null` disables it (not recommended). |
| `maxFields` | No | Hard cap on the number of fields a client may include in `?sort=`. If absent, adapters apply an implicit ceiling (5 in the reference implementation). |

**Field name lexical rule:** every entry in `fields`, `default`, and `tieBreaker` must match `^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$`. This is a security boundary — field names are interpolated into raw SQL, which SQLite does not parameterize. The pattern validator enforces this at lint time; the runtime parser enforces it again as defense in depth.

**Sort order is an oracle:** fields whose ordering would leak information (SSN, dateOfBirth, internal risk scores, sensitive flags) MUST NOT appear in `x-sortable.fields` even if they're technically sortable. The pattern validator emits a warning when fields tagged `x-pii: true` or matching common sensitive name patterns appear in `x-sortable.fields`.

See `packages/contracts/patterns/api-patterns.yaml#sorting` for the full convention (syntax, error codes, null-value ordering) and `components/parameters.yaml#SortParam` for the shared query parameter component.

---

## x-status

**File type:** `*-openapi.yaml` — `info` level (entire API) or operation level (partial implementations).

Implementation or lifecycle status. Tooling uses this to generate status banners and filter documentation views. Add a matching description banner so the status is visible regardless of tooling support.

```yaml
# workflow-openapi.yaml
info:
  title: Workflow Service API
  x-status: alpha
  description: |
    > **Status: Alpha** — Breaking changes expected.
```

Valid values: `planned`, `alpha`, `beta`, `stable`, `deprecated`.

---

## x-visibility

**File type:** `*-openapi.yaml` — `info` level or operation level.

Who can access this API or operation. Drives documentation visibility, API gateway policies, and client generation scoping.

```yaml
# intake-openapi.yaml
info:
  title: Applications API
  x-visibility: public
```

Valid values: `public` (external consumers), `partner` (authorized integration partners), `internal` (staff and system-to-system, default).
