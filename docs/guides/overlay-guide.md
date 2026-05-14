# Overlay Guide

> **Status: Draft**

Overlays are the mechanism for customizing base specs without forking them. They let you adapt the base contracts to your requirements — different enum values, additional properties, local terminology — while still tracking the shared baseline.

## How It Works

The resolve pipeline merges base specs with your overlay files into a resolved output directory. All tooling — mock server, Postman generation, client generation — operates on the resolved output, never the base specs directly.

```bash
npm run resolve -- --spec=<spec-dir> --overlay=<overlay-dir> --out=<out-dir>
```

The example overlay in this repo is at `packages/contracts/overlays/example/`. See [Resolve Pipeline Architecture](../architecture/resolve-pipeline.md) for the full pipeline stages.

## Overlay File Structure

Overlays use the [OpenAPI Overlay Specification 1.0.0](https://github.com/OAI/Overlay-Specification):

Overlay files can be organized however you like — one file per OpenAPI spec being modified is a common pattern, but not required. The overlay directory is scanned recursively; any `.yaml` file starting with `overlay: 1.0.0` is discovered and applied.

## Overlay Actions

### Replace Values

Replace enum values, descriptions, or other scalar values:

```yaml
- target: $.Person.properties.status.enum
  description: Use California terminology
  update:
    - active
    - inactive
    - pending_review
```

### Add Properties

Add new fields to an existing schema:

```yaml
- target: $.Person.properties
  description: Add state-specific fields
  update:
    stateId:
      type: string
      description: State-assigned identifier
    localOffice:
      type: string
      description: Local office code
```

### Remove Properties

Remove fields that don't apply to your state:

```yaml
- target: $.Person.properties.federalId
  description: Not used in this state
  remove: true
```

### Rename Properties

Rename a property to match state-specific terminology. This is a custom extension to the OpenAPI Overlay spec that copies the full property definition to a new name and removes the old one:

```yaml
- target: $.Person.properties.federalProgramId
  description: Use California-specific name
  rename: calworksId
```

The entire property definition (type, description, pattern, enum, etc.) is preserved under the new name. This is useful when:
- A state uses different terminology for the same concept
- You want to align API field names with state system field names
- The base schema uses a generic name that should be state-specific

### Append to an Array

Add items to an existing array without replacing the baseline items. This is a custom extension and is the main way to extend behavioral YAML arrays (transitions, rules, SLA types, metrics):

```yaml
- target: $.slaTypes
  description: Add TANF standard SLA type
  append:
    - id: tanf_standard
      name: TANF Standard
      duration:
        amount: 45
        unit: days
      warningThresholdPercent: 75
```

Use `append:` when you want to extend the baseline. Use `update:` when you want to replace the array entirely.

## Behavioral YAML Targets

The same overlay mechanism works for behavioral YAML files — state machines, rules, SLA types, and metrics — not just OpenAPI specs. A single overlay file can target both:

```yaml
actions:
  - target: $.Person.properties.status.enum   # targets an OpenAPI spec file
    description: Use state-specific status values
    update: [active, inactive, pending_review]

  - target: $.slaTypes[?(@.id == 'snap_expedited')].duration.amount  # targets a behavioral YAML file
    description: Extend SNAP expedited deadline per state waiver
    update: 10
```

The resolver automatically routes each action to the correct file based on which file contains the target path. No `file:` property needed unless the same path exists in multiple files.

### Filter Expressions

To target a specific item in a behavioral YAML array, use a filter expression:

```
$.arrayName[?(@.field == 'value')].propertyToModify
```

**Modify a specific SLA type:**

```yaml
- target: $.slaTypes[?(@.id == 'snap_expedited')].duration.amount
  description: Extend SNAP expedited to 10 days per state waiver
  update: 10
```

**Remove a specific metric:**

```yaml
- target: $.metrics[?(@.id == 'release_rate')]
  description: Remove release_rate metric (not tracked in this state)
  remove: true
```

Filter expressions support string, numeric, and boolean values:
- `[?(@.id == 'snap_expedited')]` — string match
- `[?(@.order == 1)]` — numeric match
- `[?(@.enabled == true)]` — boolean match

### State machine targets

State machine files use a top-level `machines:` array. Use a filter expression to target a specific machine by its `object` name, then drill into `transitions`, `events`, `procedures`, or `guards`:

**Add a guard to a specific transition:**

```yaml
- target: $.machines[?(@.object == 'Task')].transitions[?(@.id == 'claim')].guards
  description: Require office match before claiming
  update:
    - actors: [caseworker]
      conditions:
        - callerOfficeMatchesTask
```

**Add a new transition:**

```yaml
- target: $.machines[?(@.object == 'Task')].transitions
  description: Add supervisor-override transition for state-specific escalation path
  append:
    - id: supervisor-override
      description: POST /tasks/{taskId}/supervisor-override — Supervisor bypasses standard escalation
      guards:
        - actors: [supervisor]
      from: [in_progress, pending]
      to: escalated
      steps:
        - set: { escalatedAt: $now, escalationReason: supervisor_override }
        - emit: workflow.task.escalated
```

**Replace a procedure's steps:**

```yaml
- target: $.procedures[?(@.id == 'assignToQueue')]
  description: Replace queue assignment with county-based routing
  update:
    id: assignToQueue
    steps:
      - set: { queueId: $context.countyQueue.id }
```

**Add a new event subscription:**

```yaml
- target: $.machines[?(@.object == 'Task')].events
  description: React to county transfer events
  append:
    - name: case_management.case.county_transferred
      steps:
        - call: assignToQueue
```

## Global Config Options

The `config` root key in any overlay file sets cross-cutting defaults that apply across the entire resolved spec. It is processed by the resolve pipeline before any `actions` are applied.

```yaml
# Example: global-config.yaml in your overlay directory
overlay: 1.0.0
info:
  title: My State Overlay
  version: 1.0.0

config:
  x-casing:
    style: snake_case
  x-pagination:
    style: cursor
  x-search:
    style: filtered
  x-relationship:
    style: expand
```

| Key | Options | Default | Description |
|-----|---------|---------|-------------|
| `x-casing` | `camelCase`, `snake_case` | `camelCase` | Property name casing in resolved output |
| `x-pagination.style` | `offset`, `cursor`, `page`, `links` | `offset` | Pagination strategy for list endpoints |
| `x-search.style` | `simple`, `filtered`, `post-search` | `simple` | Search query pattern |
| `x-relationship.style` | `links-only`, `expand`, `include`, `embed` | `links-only` | How FK references are represented in responses |

Only include keys you want to override — omitted keys use their defaults. Each key may only appear once across all overlay files; duplicates produce an error. We recommend keeping config in a dedicated file (e.g., `global-config.yaml`) separate from schema modifications.

## Relationship Configuration

FK fields in the base specs are plain string IDs. States can declare how related resources are represented in responses by adding `x-relationship` to FK fields via overlays. The resolver transforms the spec at build time based on the chosen style.

### Available styles

| Style | Description | Status |
|-------|-------------|--------|
| `links-only` | Adds a `links` object with URIs to related resources | Default, implemented |
| `expand` | Replaces FK field with the related object, resolved at build time | Implemented |
| `include` | JSON:API-style sideloading in an `included` array | Planned |
| `embed` | Always inline related resources in the response | Planned |

### Setting a global default

Set `x-relationship.style` in the `config` block — see [Global Config Options](#global-config-options).

### Per-field configuration

Add `x-relationship` to specific FK fields via overlay actions. Per-field `style` overrides the global default:

```yaml
actions:
  - target: $.components.schemas.Task.properties.assignedToId
    file: workflow-openapi.yaml
    description: Expand assignedToId with field subset
    update:
      type: string
      format: uuid
      description: Reference to the User assigned to this task.
      x-relationship:
        resource: User
        style: expand
        fields: [id, name, email]
```

- `resource` (required) — the target schema name (e.g., `User`, `Case`)
- `style` (optional) — overrides the global style for this field
- `fields` (optional, expand only) — subset of fields to include; supports dot notation for nested relationships

### What each style produces

**links-only** keeps the FK field and adds a read-only `links` object to the parent schema:

```yaml
# Base: Task.assignedToId → User
# Result:
Task:
  properties:
    assignedToId:
      type: string
      format: uuid
    links:
      type: object
      readOnly: true
      properties:
        assignedTo:
          type: string
          format: uri
```

**expand** replaces the FK field with the related object, resolved at build time. The field is renamed (dropping the `Id` suffix) and the response shape is static — no query parameters needed.

Without `fields` — the full related schema is included and example data is recursively expanded. If the related schema has its own `x-relationship` annotations, those FK fields are also expanded (in both schema and example data). Unannotated FK fields on the related schema remain as plain IDs.

```yaml
# x-relationship: { resource: User, style: expand }
# Schema result:
Task:
  properties:
    assignedTo:
      $ref: '#/components/schemas/User'

# Example data result (assuming User.teamId has x-relationship: { resource: Team, style: expand }):
# TaskExample1.assignedTo:
#   id: user-001
#   name: Jane Smith
#   team:           ← expanded because User.teamId also has x-relationship
#     id: team-001
#     name: Intake Team
#   departmentId: dept-001   ← kept as plain ID — no x-relationship annotation
```

With `fields` — an inline subset object is produced:

```yaml
# x-relationship: { resource: User, style: expand, fields: [id, name, email] }
# Result:
Task:
  properties:
    assignedTo:
      type: object
      properties:
        id: { type: string, format: uuid }
        name: { type: string }
        email: { type: string, format: email }
```

### Dot notation in fields

Use dot notation in `fields` to reach into related resources across FK chains. Each segment must correspond to an FK field annotated with `x-relationship` on the intermediate schema.

```yaml
# Task.caseId → Case, Case.applicationId → Application
x-relationship:
  resource: Case
  style: expand
  fields:
    - id              # Case.id
    - status          # Case.status
    - application.id  # Case → Application → id
    - application.name
```

Result:

```yaml
Task:
  properties:
    case:
      type: object
      properties:
        id: { type: string, format: uuid }
        status: { type: string }
        application:
          type: object
          properties:
            id: { type: string, format: uuid }
            name: { type: string }
```

Dot notation works to any depth. Example data is also transformed — FK UUIDs are joined across example files to produce the nested structure.

You can choose how much of a chain to traverse per field:

```yaml
fields:
  - id
  - applicationId          # raw UUID — keep the FK as-is
  - application.id         # expand one level: Case → Application
  - application.program.name  # expand two levels: Case → Application → Program
```

## Target Path Syntax

Targets use JSONPath-like syntax. Where a schema lives determines its path prefix:

- **Schemas in API spec files** (e.g., `workflow-openapi.yaml`) — nested under `components/schemas`, so the target starts with `$.components.schemas.`
- **Schemas in shared component files** (e.g., `components/common.yaml`) — top-level in the file, so the target starts with `$.`

### File Disambiguation

When the same schema name appears in multiple files, use `file:` to specify which one. Without it, the resolver warns and skips ambiguous matches.

```yaml
- target: $.Program.enum
  file: components/common.yaml
  description: Replace program names with state terminology
  update:
    - snap
    - tanf
    - medicaid
```

### Version and API Disambiguation

When multiple API versions exist (e.g., `applications.yaml` and `applications-v2.yaml`), use `target-version` or `target-api` to narrow the match:

```yaml
- target: $.components.schemas.Person.properties
  target-version: 2
  description: Add field only to v2 spec

- target: $.components.schemas.Application
  target-api: applications
  description: Target a specific API by its x-domain value
```

`target-api` matches the spec's `info.x-api-id` value. `target-version` matches the filename version suffix (no suffix = 1, `-v2` = 2).

## Creating a New Overlay

Copy the example overlay as a starting point, then add actions for each modification needed:

```bash
cp packages/contracts/overlays/example/modifications.yaml <your-overlay-dir>/modifications.yaml
```

## Working with Shared Types

Shared types (Address, Name, etc.) live in `components/*.yaml` and are referenced by multiple API specs via `$ref`. There are two approaches to customizing them:

### Approach 1: Modify the shared type via overlay

Changes propagate to all specs that reference the type.

```yaml
# Add a field to Address — affects all APIs
- target: $.Address.properties
  file: components/contact.yaml
  description: Add apartment/unit field to Address
  update:
    unit:
      type: string
      description: Apartment or unit number.
```

### Approach 2: Replace a $ref with an inline schema

Decouple from the shared type entirely. Use `update` to swap a `$ref` with a custom inline schema.

```yaml
- target: $.components.schemas.Person.allOf.0.properties.address
  file: persons.yaml
  description: Use custom address format
  update:
    type: object
    properties:
      street1:
        type: string
      street2:
        type: string
      city:
        type: string
      state:
        type: string
        enum: [CA]
      zipCode:
        type: string
        pattern: "^[0-9]{5}(-[0-9]{4})?$"
```

Note: the `components/` folder is preserved in resolved output — this is expected and harmless. Downstream tools consume the resolved API spec files, not the component files directly.

## Best Practices

### Use Descriptive Actions

Always include a `description` for each action:

```yaml
- target: $.Person.properties.sex.enum
  description: California Gender Recognition Act compliance  # Good
  update: [...]
```

### Keep Overlays Focused

Each action should do one thing. Don't combine unrelated changes:

```yaml
# Good: separate actions
- target: $.Person.properties.status.enum
  description: Update status values
  update: [...]

- target: $.Person.properties
  description: Add county field
  update:
    countyCode: {...}

# Avoid: combining unrelated changes in one action
```

### Test After Changes

Always validate after modifying overlays:

```bash
npm run resolve -- --spec=<spec-dir> --overlay=<overlay-dir> --out=<out-dir>
```

### Document State Differences

Add comments in the overlay explaining why changes are needed:

```yaml
actions:
  # California uses branded program names per state law AB-1234
  - target: $.components.schemas.Application.properties.programs.items.enum
    description: California branded program names
    update:
      - calfresh      # California's SNAP program
      - calworks      # California's TANF program
      - medi_cal      # California's Medicaid program
```

## Troubleshooting

### Target Not Found Warning

```
⚠ Target $.Person.properties.foo does not exist in base schema
```

**Cause:** The target path doesn't exist in the base schema.

**Fix:** Check the base schema structure and correct the path.

### Overlay Not Applied

If your changes don't appear in resolved specs:

1. Re-run resolution: `npm run resolve -- --spec=<spec-dir> --overlay=<overlay-dir> --out=<out-dir>`
2. Check the target path matches the file structure

### Validation Errors After Overlay

If validation fails after applying an overlay:

1. Check your overlay syntax is valid YAML
2. Ensure enum values are valid strings
3. Verify new properties have required fields (type, description)

## Reference

- [Customization Strategy](../decisions/state-customization.md)
- [OpenAPI Overlay Specification](https://github.com/OAI/Overlay-Specification)
