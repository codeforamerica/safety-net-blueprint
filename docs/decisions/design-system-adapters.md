# Design Decision: Pluggable Design System Adapters

**Status:** Accepted
**Issue:** [#106](https://github.com/codeforamerica/safety-net-blueprint/issues/106)

## Context

The harness app and form renderer use `@trussworks/react-uswds` components and USWDS CSS. Honeycrisp (Code for America's USWDS-based design system) is the preferred default, but states need the ability to use vanilla USWDS or their own design system. Honeycrisp is not a pure CSS token swap — it requires `.cfa-` prefixed classes on component markup (inputs, selects, buttons, form groups, etc.) in addition to its USWDS token overrides.

## Decision

Design system adaptation is handled through a configuration file (`ds.config.json`) and a theme module that generates CSS class mappings at build time. The form renderer applies these classes to `@trussworks/react-uswds` components automatically. All colors use USWDS utility classes so they match the active theme.

No separate adapter packages are required. The configuration is a single JSON file with a class prefix and optional overrides.

## How It Works

1. `ds.config.json` specifies a `classPrefix` (e.g. `"cfa"` for Honeycrisp, `""` for vanilla USWDS).
2. The theme module generates class names by combining the prefix with each component role in kebab-case: `cfa` + `input` → `cfa-input`, `cfa` + `formGroup` → `cfa-form-group`.
3. If a design system doesn't follow the `{prefix}-{role}` convention, individual mappings can be overridden via `classOverrides`.
4. Components import the class map (`ds.input`, `ds.button`, etc.) and apply it alongside the base USWDS classes.

## Rationale

- **Minimal configuration.** One string (the prefix) handles most design systems. No packages to create or publish.
- **Build-time resolution.** The class map is generated at module initialization. No runtime overhead.
- **USWDS utility classes for colors.** Components use standard USWDS classes (`text-primary`, `bg-base-lightest`, etc.) instead of hard-coded hex values, so colors automatically match the active USWDS theme.
- **Override escape hatch.** The `classOverrides` object handles design systems with non-standard naming, including multiple classes per component.
- **Existing components stay.** `@trussworks/react-uswds` components are used regardless — the config controls which extra CSS classes are applied.

## Full Guide

See [Design System Adapters Guide](../guides/design-system-adapters.md) for configuration details, switching instructions, and integration patterns.
