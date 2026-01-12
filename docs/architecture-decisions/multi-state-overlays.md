# ADR: Multi-State Support Using OpenAPI Overlays

**Status:** Accepted

**Date:** 2026-01-06

**Deciders:** Development Team

---

## Context

The Safety Net OpenAPI toolkit needs to support multiple states, each with variations in:

- **Enum values** - Different program names (e.g., "CalFresh" vs "SNAP")
- **Additional properties** - State-specific fields (e.g., county codes, eligibility flags)
- **Terminology** - Different labels for the same concepts (e.g., citizenship status categories)

The core data structures and API patterns remain consistent across states—only the details vary.

### Requirements

- Support state-specific schema variations without duplicating entire API specs
- Single-state deployment model (one state active at a time)
- Clear visibility into what differs between states
- Minimal impact on existing tooling (mock server, client generation, validation)
- Easy to add new states

### Constraints

- Must work with OpenAPI 3.1 specifications
- Should not require maintaining parallel copies of similar schemas
- Changes to base schemas should automatically propagate to all states

---

## Decision

We chose **OpenAPI Overlay Specification (1.0.0)** with a configuration-driven single-state deployment model.

### How It Works

1. **Base schemas** in `openapi/` define the universal structure
2. **Overlay files** in `openapi/overlays/{state}/modifications.yaml` declare state-specific modifications
3. **Resolve script** merges base + overlay → `openapi/resolved/` at build time
4. **All tooling** operates on resolved specs, unaware of the overlay system

### Configuration

```bash
# Set active state via environment variable
STATE=california npm start

# Or via CLI argument
npm run overlay:resolve -- --state=colorado
```

### File Structure

```
openapi/
├── persons.yaml              # Base API spec
├── components/
│   ├── person.yaml           # Base schema
│   └── application.yaml      # Base schema
├── overlays/
│   ├── california/
│   │   ├── modifications.yaml    # Overlay actions
│   │   └── replacements/         # Complete schema replacements
│   │       └── expenses.yaml
│   └── colorado/
│       ├── modifications.yaml
│       └── replacements/
└── resolved/                 # .gitignored, generated at build time
    ├── persons.yaml
    └── components/
        └── person.yaml       # State-specific resolved schema
```

### Overlay File Format

```yaml
# overlays/california/modifications.yaml
overlay: 1.0.0
info:
  title: California State Overlay
  version: 1.0.0

actions:
  # Replace enum values
  - target: $.Person.properties.citizenshipStatus.enum
    description: California uses USCIS-aligned terminology
    update:
      - us_citizen
      - lawful_permanent_resident
      - qualified_alien
      - prucol
      - undocumented

  # Add new properties
  - target: $.Person.properties
    description: Add California county tracking
    update:
      countyCode:
        type: string
        description: California county code (01-58)
      calfreshEligible:
        type: boolean
        description: CalFresh eligibility flag

  # Rename properties (custom extension)
  - target: $.Person.properties.federalProgramId
    description: Use California-specific name
    rename: calworksId

  # Replace entire schema with state-specific structure (custom extension)
  - target: $.PersonExpenses
    description: California expense tracking structure
    replace:
      $ref: "./replacements/expenses.yaml#/CaliforniaExpenses"
```

### Custom Extensions

We extend the OpenAPI Overlay spec with custom actions:

| Action | Standard | Description |
|--------|----------|-------------|
| `update` | Yes | Merge/replace values at target path |
| `remove` | Yes | Delete value at target path |
| `rename` | **No** (custom) | Rename property, preserving full definition |
| `replace` | **No** (custom) | Complete replacement of target (no merging) |

The `rename` action copies the entire property definition to a new key and removes the old key. This is useful when states use different terminology for the same concept without having to duplicate the property definition.

The `replace` action completely replaces the target value (unlike `update` which merges objects). It supports `$ref` to load replacement schemas from separate files in the `replacements/` directory. This is useful when a state needs a fundamentally different structure that can't be achieved through property updates.

### File Scoping

When a target path exists in multiple files (e.g., a schema name that appears in both `person.yaml` and `application.yaml`), you can use the `file` or `files` property to specify which file(s) to apply the action to:

```yaml
actions:
  # Apply to a single specific file
  - target: $.CitizenshipInfo.properties.status.enum
    description: California uses USCIS-aligned terminology
    file: components/person.yaml
    update:
      - us_citizen
      - lawful_permanent_resident

  # Apply to multiple specific files
  - target: $.Program.enum
    description: Update program names in multiple files
    files:
      - components/common.yaml
      - components/application.yaml
    update:
      - CalFresh
      - Medi-Cal
```

**Smart Auto-Detection:**

The resolver uses two-pass processing to automatically determine where to apply actions:

1. **Target in 0 files** - Warning: target doesn't exist anywhere
2. **Target in 1 file** - Auto-apply to that file (no `file` property needed)
3. **Target in 2+ files** - Require `file` or `files` property to disambiguate

This means most actions don't need explicit file scoping - the resolver automatically finds where each target path exists and applies the action there. Only when the same exact target path exists in multiple files (indicating potential ambiguity) does the overlay require explicit file specification.

---

## Options Considered

### Option 1: Schema Inheritance with `allOf`

```yaml
# california/person.yaml
CaliforniaPerson:
  allOf:
    - $ref: "../base/person.yaml#/Person"
    - type: object
      properties:
        countyCode:
          type: string
```

| Pros | Cons |
|------|------|
| Familiar OpenAPI pattern | Must redefine structure to extend |
| Works with all tools | Can't easily replace enum values |
| Clear inheritance chain | Verbose for small changes |

**Rejected because:** Enum replacement requires redefining the entire property, leading to duplication. Adding a single field requires significant boilerplate.

---

### Option 2: Configuration-Driven Variants

```yaml
# config/california.yaml
enabled_fields:
  - countyCode
  - calfreshEligible
enum_overrides:
  citizenshipStatus:
    - us_citizen
    - lawful_permanent_resident
```

| Pros | Cons |
|------|------|
| Simple configuration | Custom processing needed |
| Easy to compare states | Not a standard format |
| Minimal duplication | Limited expressiveness |

**Rejected because:** Requires custom tooling to interpret configuration. Not an established standard.

---

### Option 3: OpenAPI Overlays (CHOSEN)

| Pros | Cons |
|------|------|
| Official OpenAPI specification | Relatively new (v1.0.0 in 2024) |
| Surgical precision for changes | Requires preprocessing step |
| Declarative, auditable diffs | JSONPath targets can be fragile |
| Growing tooling support | |

**Accepted because:** Best fit for "mostly the same with small variations" pattern. Changes are proportional to the actual differences. Official spec with improving ecosystem support.

---

### Option 4: Separate Specs Per State

```
openapi/
├── california/
│   ├── persons.yaml
│   └── components/person.yaml
├── colorado/
│   ├── persons.yaml
│   └── components/person.yaml
```

| Pros | Cons |
|------|------|
| Maximum flexibility | High duplication |
| No preprocessing | Drift between states |
| Simple to understand | Bug fixes must be applied N times |

**Rejected because:** Too much duplication for schemas that are 90%+ identical. High maintenance burden as the number of states grows.

---

## Decision Rationale

| Factor | Benefit |
|--------|---------|
| **Proportional changes** | Small state variations = small overlay files |
| **Single source of truth** | Base schemas define structure; overlays define variations |
| **Automatic propagation** | Base schema fixes apply to all states |
| **Auditable differences** | Each overlay file is a clear manifest of state-specific changes |
| **Simple deployment** | `STATE=california` controls everything |
| **Tooling compatibility** | Resolved specs are standard OpenAPI; existing tools work unchanged |

---

## Consequences

### Positive

- Clear separation between universal patterns and state-specific variations
- Easy to add new states (create one overlay file)
- Easy to compare states (diff the overlay files)
- Base schema improvements automatically apply everywhere
- No changes needed to mock server, client generation, or validation tooling

### Negative

- Requires preprocessing step before other tooling runs
- JSONPath targets in overlays are coupled to schema structure
- Overlay specification is relatively new (less tooling maturity)
- Debugging requires understanding both base and overlay

### Mitigations

1. **Preprocessing integrated into workflow** - `npm start` and other commands run overlay resolution first
2. **Descriptive comments** - Each overlay action includes a description explaining the change
3. **Validation** - Resolved specs go through the same validation as base specs via `npm run validate:state`
4. **Overlay target validation** - The resolve script warns when overlay targets don't exist in the base schema, catching typos and stale overlays
5. **Multi-state validation** - `npm run validate:all-states` validates all states in one command, ensuring changes don't break any state

---

## Implementation

### Commands Added

| Command | Description |
|---------|-------------|
| `npm run overlay:resolve` | Resolve overlays for current STATE |
| `npm run validate:state` | Resolve overlay and validate resolved specs for current STATE |
| `npm run validate:all-states` | Resolve and validate all available states |
| `STATE=california npm start` | Start servers with California schemas |

### Files Changed/Added

| File | Change |
|------|--------|
| `src/overlay/overlay-resolver.js` | Core overlay resolution logic with `rename` and `replace` action support |
| `scripts/resolve-overlay.js` | CLI script to apply overlays with target validation |
| `scripts/validate-state.js` | New script to resolve and validate state specs |
| `scripts/validate-patterns.js` | Updated to support `--dir` argument |
| `openapi/overlays/{state}/modifications.yaml` | State-specific overlay actions |
| `openapi/overlays/{state}/replacements/` | State-specific schema replacements |
| `openapi/resolved/` | Generated directory (.gitignored) |
| `package.json` | Added overlay and state validation scripts |
| `.gitignore` | Added `openapi/resolved/` |

### Example Usage

```bash
# List available states
npm run overlay:resolve
# Output: Available states: california, colorado

# Resolve California overlay
STATE=california npm run overlay:resolve

# Validate a single state (resolves + validates)
STATE=california npm run validate:state

# Validate all states
npm run validate:all-states

# Start mock server with California schemas
STATE=california npm start

# Generate California-specific TypeScript client
STATE=california npm run clients:generate
```

---

## Future Considerations

- **Multi-state mode** - If needed, could extend to support multiple states simultaneously with routing
- **Overlay diffing** - Could generate comparison reports between states
- **External overlay library** - If overlays grow complex, could use a dedicated library like `@readme/oas-overlay`

---

## References

- [OpenAPI Overlay Specification 1.0.0](https://github.com/OAI/Overlay-Specification)
- [Redocly Overlay Support](https://redocly.com/docs/cli/guides/overlay/)
- [Bump.sh Overlay Documentation](https://docs.bump.sh/guides/openapi/overlays/)
