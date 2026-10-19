# @codeforamerica/blueprint-cli

## 0.5.0

### Minor Changes

- **Breaking:** `blueprint-evaluate` now takes only a compiled graph, `--spec=<*-graph.yaml>`, with `--input` or `--examples=<*-rules-examples.yaml>`; it no longer compiles a rules or rules examples file, which missed schemas in other files, and `--engine` is gone. It exits 1 when any fact comes back as an error.
- Before, `blueprint-resolve` took one `--overlay`, so applying a package's own overlays and then a state's meant copying them into one folder. Now `--overlay` can be given more than once and applies in the order given, and a second `--spec` is refused instead of silently replacing the first. (#478)
- **Breaking:** Before, a state machine subscribed under `events:` and emitted full event names. Now it subscribes under `on:`, declares its resource's events once under `emits:` and sends them by name (`emit: claimed`), which resolve expands to `{domain}.{resource}.{event}`. (#470)
- **Breaking:** Resolve now writes `<name>-events-asyncapi.yaml` beside each OpenAPI document, documenting every event its resources and their state machines send, so `x-events` and a state machine's `eventsSpec` are ignored, with a warning, and a hand-written channel for a generated event is a validation error. (#470)
- A contract set can now include the framework's `communication` capability by listing it in `x-capabilities`: `/communication/transcripts` records transcripts under a profile from `/communication/profiles`, with their timeline at `/transcripts/{id}/entries`. A new `x-enum-source: { registry: <type> }` form draws an enum from a registry. (#470)
- **Breaking:** Before, the explorer drew sequence diagrams and context-map flows from hand-written `flows:`, `actors:` and `sequence-diagrams/config/` files that drifted from the contracts. Now those are gone: remove `flows:` and `actors:` from your explorer `config.yaml`, which no longer validates with them, and stop calling `buildSequenceDiagrams` or `--only=sequence-diagrams`. (#311)

### Patch Changes

- Before, `blueprint-resolve --bundle` failed on a schema that refers to a `https://blueprint.codeforamerica.org/schemas/...` URL. Now those URLs are read from the installed blueprint. (#470)
- Before, an overlay file carrying only a `config:` block, with no `actions:`, was skipped, so its settings had no effect. Now resolve reads it. (#470)
- Each package now declares its license, `PolyForm-Noncommercial-1.0.0`, so npm and dependency scanners show it. The terms are unchanged. (#452)
- Uses @codeforamerica/blueprint-core 0.4.0, @codeforamerica/blueprint-explorer 0.3.0, @codeforamerica/blueprint-rules-engine 0.2.0.

## 0.4.0

### Minor Changes

- Before, booting the mock server meant pointing it at a contracts directory for it to walk. Now `blueprint-bundle-contracts --spec=<dir> --out=contracts.json` writes the set to one JSON file that `blueprint-mock --spec=contracts.json` or a browser can boot from, with `--domain=<name>` to include a single domain. (#448)

### Patch Changes

- Before, `--env-variables` merged the whole environment over the file, so any `${VAR}` in a contract could pick up a machine value — `${HOME}` resolved to a developer's home directory. Now the file declares which variables exist and the environment supplies values only for those; an undeclared one is reported as unresolved. Declare it in the file if you were relying on it. (#464)
- Before, `blueprint-resolve` wrote output even when a `${VAR}` placeholder had no value, leaving the literal text in the artifacts — and validation passed, because an event type and the channel it names were given the same literal. Now resolve reports the unresolved names and exits without writing. (#464)
- Uses @codeforamerica/blueprint-core 0.3.0, @codeforamerica/blueprint-explorer 0.2.1.

## 0.3.0

### Minor Changes

- **Breaking:** Annotation files key fields by spec-relative path
  (`application.members[].dateOfBirth`) rather than schema-relative path
  (`member.dateOfBirth`). The first segment is the camelCase schema name,
  followed by the dot-bracket field path. This matches the data dictionary and
  the field inventory, so one path form works across all three.
- `blueprint-build-explorer` is a new CLI for building the Blueprint Explorer static site from a resolved contracts directory.
- `blueprint-evaluate` is a new CLI for running rules from the command line.
  Pass a compiled graph, a rules file, or a rules examples file to evaluate
  every ruleset and example and return per-example results as JSON. (#425)
- The TypeScript client generator now emits a `Rules` export for domains with
  compiled graphs — `domain.Rules.<ruleset>.evaluate(inputs)` runs the graph in
  the browser with no network call, typed by `${Ruleset}Inputs` and
  `${Ruleset}Result`. Requires `@codeforamerica/blueprint-rules-engine` as a
  peer dependency. (#425)
- `blueprint-validate` now validates rules contracts, including cycle detection,
  unreachable node detection, and CEL expression syntax checking. (#425)
- `blueprint-resolve --bundle` now preserves all standalone contract files in the bundled output — annotations, metrics, SLA types, mock data, policies, and rules examples are no longer incorrectly removed alongside shared component files.
- `blueprint-resolve` now applies the `x-event-type-prefix` overlay config to annotation event keys, so resolved contracts stay consistent across all artifact types (state machine, AsyncAPI, and annotations).
- Uses @codeforamerica/blueprint-core 0.2.0, @codeforamerica/blueprint-explorer 0.2.0.

## 0.2.3

### Patch Changes

- `blueprint-generate-ts-clients` now works reliably from a clean checkout. Previously, a cold npx cache caused the generator to download `@hey-api/openapi-ts@latest` instead of the pinned version, which crashed on startup with a `TypeError`. (#439)

## 0.2.2

### Patch Changes

- `api:new` and `api:update` now pluralize resource names correctly — scaffolding `Child` produces `/children`, `listChildren` and the `Children` tag instead of `childs` — and they generate a `<Resource>Writable` base schema that the Create and Update request bodies extend, so server-managed fields like `id`, `createdAt` and `updatedAt` no longer appear in request payloads. (#378)

## 0.2.1

### Patch Changes

- `blueprint-resolve` now exits with a clear error if `blueprint-core`'s base contracts are missing, rather than silently producing broken output. The `base-contracts/` and `assets/` directories are now correctly included in the `blueprint-core` npm package, fixing resolution failures for consumers who installed from npm.
- Uses @codeforamerica/blueprint-core 0.1.1.

## 0.2.0

### Minor Changes

- `blueprint-export-schemas` is a new CLI that exports OpenAPI component schemas as standalone JSON Schema files, organized by domain — useful when downstream tooling needs JSON Schema without the full OpenAPI spec.
