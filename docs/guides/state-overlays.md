# State Overlays Guide

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
STATE=<your-state> npm run validate:state
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
  - target: $.Person.properties.gender.enum
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

## Target Path Syntax

Targets use JSONPath-like syntax:

| Target | Description |
|--------|-------------|
| `$.Person` | Root schema |
| `$.Person.properties` | All properties |
| `$.Person.properties.status` | Specific property |
| `$.Person.properties.status.enum` | Enum values |
| `$.Application.properties.programs.items` | Array item schema |

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
STATE=<new-state> npm run validate:state
```

The resolver will warn you about any invalid targets:

```
Warnings:
  ⚠ Target $.Person.properties.nonexistent.enum does not exist in base schema
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run overlay:resolve` | Resolve overlay for current STATE |
| `npm run validate:state` | Resolve and validate current STATE |
| `npm run validate:all-states` | Validate all available states |

## Best Practices

### Use Descriptive Actions

Always include a `description` for each action:

```yaml
- target: $.Person.properties.gender.enum
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
STATE=<your-state> npm run validate:state
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

## Reference

- [Multi-State Architecture ADR](../architecture-decisions/multi-state-overlays.md)
- [OpenAPI Overlay Specification](https://github.com/OAI/Overlay-Specification)
