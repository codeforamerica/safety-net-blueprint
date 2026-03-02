# Design System Adapters

The blueprint supports pluggable design systems through a configuration file and a theme module. You set a class prefix, and the form renderer automatically applies the correct CSS classes to every component. Honeycrisp (Code for America's USWDS-based design system) is the default.

## How It Works

The form renderer uses `@trussworks/react-uswds` components. These render standard USWDS markup. Some design systems — like Honeycrisp — require additional CSS classes on that markup (e.g. `cfa-input`, `cfa-button`). The theme module generates these class names from a prefix and applies them automatically.

```
ds.config.json → theme module → ds.input, ds.button, ... → components
```

Components import the class map and use it:

```tsx
import { ds } from '../theme';

<TextInput className={ds.input} ... />
<Button className={ds.button} ... />
```

When the prefix is `"cfa"`, `ds.input` resolves to `"cfa-input"`. When the prefix is `""`, it resolves to `""` — no extra class, just the base USWDS styling.

All colors in the form renderer use USWDS utility classes (`text-primary`, `bg-base-lightest`, `border-base-lighter`, etc.) so they automatically match the active USWDS theme.

## Configuration

The design system is configured via `ds.config.json` in the package root:

```json
{
  "classPrefix": "cfa",
  "classOverrides": {}
}
```

### `classPrefix`

A string prepended to each component role to generate CSS class names. The role name is converted to kebab-case.

| Prefix | Generated classes |
|---|---|
| `"cfa"` | `cfa-form`, `cfa-input`, `cfa-button`, `cfa-form-group`, ... |
| `""` | (empty strings — no extra classes) |
| `"mystate"` | `mystate-form`, `mystate-input`, `mystate-button`, ... |

### `classOverrides`

Optional per-component overrides for design systems that don't follow the `{prefix}-{role}` convention. Only specify the keys that differ — everything else uses the generated name.

```json
{
  "classPrefix": "branded",
  "classOverrides": {
    "input": "branded-text-field",
    "formGroup": "branded-field-wrapper"
  }
}
```

Multiple classes per component are supported:

```json
{
  "classOverrides": {
    "input": "branded-input form-control"
  }
}
```

### Component roles

The full set of roles that the theme module generates classes for:

| Key | Applies to | USWDS component |
|---|---|---|
| `form` | Form element | `Form` |
| `formGroup` | Form group wrapper | `FormGroup` |
| `label` | Label element | `Label` |
| `input` | Text input | `TextInput` |
| `select` | Select dropdown | `Select` |
| `fieldset` | Fieldset element | `Fieldset` |
| `radio` | Radio button | `Radio` |
| `checkbox` | Checkbox | `Checkbox` |
| `button` | Button element | `Button` |
| `accordion` | Accordion wrapper | `Accordion` |

## Switching Design Systems

### From Honeycrisp to vanilla USWDS

Change `ds.config.json`:

```json
{
  "classPrefix": "",
  "classOverrides": {}
}
```

Rebuild. Every form, every component, every page renders with vanilla USWDS styling. No code changes.

### Using a state's custom theme

If the state's design system uses a consistent class prefix:

```json
{
  "classPrefix": "mystate",
  "classOverrides": {}
}
```

If some class names don't follow the convention:

```json
{
  "classPrefix": "mystate",
  "classOverrides": {
    "input": "mystate-text-field"
  }
}
```

Install the state's CSS package as a dependency and import its stylesheet in the app entry point alongside USWDS.

## Storybook

Storybook reads the same `ds.config.json`. To preview with a different design system, change the config and restart Storybook.

## For Vendors

A vendor building a production system for a state receives the `ds.config.json` values as part of the spec — alongside the contracts, form definitions, and overlays. The design system configuration is a requirement the state owns, not a choice the vendor makes.

## Related

- [Design decision: Design System Adapters](../decisions/design-system-adapters.md) — rationale and architectural context
- [`@codeforamerica/uswds`](https://github.com/codeforamerica/uswds) — Honeycrisp USWDS theme
- [`@trussworks/react-uswds`](https://github.com/trussworks/react-uswds) — React USWDS components
