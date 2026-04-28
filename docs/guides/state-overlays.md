# State Overlays Guide

> **Status: Draft**

State overlays allow you to customize API specifications for different states without duplicating the entire spec. Each state can have different enum values, additional properties, and terminology while sharing the same base structure.

## How It Works

1. **Base schemas** in `openapi/` define the universal structure
2. **Overlay files** in `openapi/overlays/{state}/modifications.yaml` declare modifications
3. **Resolve script** merges base + overlay into `openapi/resolved/`
4. **All tooling** operates on resolved specs

## Setting Your State

```bash
# Set via environment variable
export STATE=<your-state>

# Or prefix commands
STATE=<your-state> npm start
STATE=<your-state> npm run overlay:resolve
```

## Available States

```bash
# List available states (run without STATE set)
npm run overlay:resolve
# Output: Available states: <lists all configured states>
```

## Overlay File Structure

Overlays use the [OpenAPI Overlay Specification 1.0.0](https://github.com/OAI/Overlay-Specification):

```yaml
# openapi/overlays/<your-state>/modifications.yaml
overlay: 1.0.0
info:
  title: <Your State> Overlay
  version: 1.0.0
  description: <Your state>-specific modifications

actions:
  # Replace enum values
  - target: $.Person.properties.sex.enum
    description: California Gender Recognition Act compliance
    update:
      - male
      - female
      - nonbinary
      - unknown

  # Add new properties
  - target: $.Person.properties
    description: Add California county tracking
    update:
      countyCode:
        type: string
        description: California county code (01-58)
        pattern: "^[0-5][0-9]$"
      calfreshEligible:
        type: boolean
        description: CalFresh eligibility flag
```

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
      durationDays: 45
      warningThresholdPercent: 75
```

Use `append:` when you want to extend the baseline. Use `update:` when you want to replace the array entirely.

## Behavioral YAML Targets

The same overlay mechanism works for behavioral YAML files — state machines, rules, SLA types, and metrics — not just OpenAPI specs. A single overlay file can target both:

```yaml
actions:
  - target: $.Person.properties.status.enum   # OpenAPI target
    description: Use state-specific status values
    update: [active, inactive, pending_review]

  - target: $.slaTypes[?(@.id == 'snap_expedited')].durationDays  # behavioral target
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
- target: $.slaTypes[?(@.id == 'snap_expedited')].durationDays
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

Set the default style for all relationships in your config overlay:

```yaml
config:
  x-relationship:
    style: expand
```

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
# Task.queueId → Queue, Queue.officeId → Office
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

Targets use JSONPath-like syntax:

| Target | Description |
|--------|-------------|
| `$.Person` | Root schema |
| `$.Person.properties` | All properties |
| `$.Person.properties.status` | Specific property |
| `$.Person.properties.status.enum` | Enum values |
| `$.Application.properties.programs.items` | Array item schema |
| `$.slaTypes` | Top-level array in a behavioral YAML |
| `$.slaTypes[?(@.id == 'snap_expedited')]` | Specific item in a behavioral YAML array |
| `$.slaTypes[?(@.id == 'snap_expedited')].durationDays` | Property of a specific array item |

## Creating a New State Overlay

### 1. Create the Overlay Directory and File

```bash
# Create state directory and copy an existing overlay as a template
mkdir openapi/overlays/<new-state>
cp openapi/overlays/<existing-state>/modifications.yaml openapi/overlays/<new-state>/modifications.yaml
```

### 2. Update the Metadata

```yaml
overlay: 1.0.0
info:
  title: New State Overlay
  version: 1.0.0
  description: New State-specific modifications
```

### 3. Define Your Actions

Add actions for each modification needed:

```yaml
actions:
  # Your state-specific changes
  - target: $.Person.properties.programType.enum
    description: State program names
    update:
      - snap
      - tanf
      - medicaid
```

### 4. Validate

```bash
STATE=<new-state> npm run overlay:resolve
```

The resolver will warn you about any invalid targets:

```
Warnings:
  ⚠ Target $.Person.properties.nonexistent.enum does not exist in base schema
```

## Commands

All commands below respect the `STATE` environment variable. When set, they automatically resolve overlays and use state-specific schemas.

| Command | Description |
|---------|-------------|
| `npm start` | Start mock server + Swagger UI |
| `npm run validate` | Validate base schemas and examples |
| `npm run mock:start` | Start mock server only |
| `npm run mock:swagger` | Start Swagger UI only |
| `npm run postman:generate` | Generate Postman collection |
| `npm run test:integration` | Run integration tests |
| `npm run overlay:resolve` | Manually resolve overlay for current STATE |

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
STATE=<your-state> npm run overlay:resolve
```

### Document State Differences

Add comments in the overlay explaining why changes are needed:

```yaml
actions:
  # California uses branded program names per state law AB-1234
  - target: $.Application.properties.programs.items.enum
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

1. Check STATE is set: `echo $STATE`
2. Re-run resolution: `npm run overlay:resolve`
3. Check the target path matches the file structure

### Validation Errors After Overlay

If validation fails after applying an overlay:

1. Check your overlay syntax is valid YAML
2. Ensure enum values are valid strings
3. Verify new properties have required fields (type, description)

## Behavioral Artifacts (Overlay Support Planned)

The following behavioral YAML artifacts exist alongside OpenAPI specs but are not yet overlayable — they are copied to the output directory unchanged. Overlay support is tracked in issue #174.

| Artifact | File pattern | Planned overlay use |
|----------|-------------|---------------------|
| State machine | `*-state-machine.yaml` | Add/modify transitions, guards, effects |
| Rules | `*-rules.yaml` | Replace or extend assignment/priority rules |
| SLA types | `*-sla-types.yaml` | Override deadlines, `pauseWhen` conditions, `autoAssignWhen` logic |
| Metrics | `*-metrics.yaml` | Add state-specific metrics or override targets |

States that need different SLA deadlines or pause conditions will be able to supply their own `*-sla-types.yaml` via overlay once #174 lands.

## Reference

- [State Customization Strategy](../decisions/state-customization.md)
- [OpenAPI Overlay Specification](https://github.com/OAI/Overlay-Specification)
