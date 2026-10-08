# @codeforamerica/blueprint-cli

## 0.4.0

### Minor Changes

- 27eda23: Before, booting the mock server meant pointing it at a contracts directory for it to walk. Now `blueprint-bundle-contracts --spec=<dir> --out=contracts.json` writes the set to one JSON file that `blueprint-mock --spec=contracts.json` or a browser can boot from, with `--domain=<name>` to include a single domain. (#448)

### Patch Changes

- 62cb9e6: Before, `--env-variables` merged the whole environment over the file, so any `${VAR}` in a contract could pick up a machine value — `${HOME}` resolved to a developer's home directory. Now the file declares which variables exist and the environment supplies values only for those; an undeclared one is reported as unresolved. Declare it in the file if you were relying on it. (#464)
- 62cb9e6: Before, `blueprint-resolve` wrote output even when a `${VAR}` placeholder had no value, leaving the literal text in the artifacts — and validation passed, because an event type and the channel it names were given the same literal. Now resolve reports the unresolved names and exits without writing. (#464)
- Updated dependencies [fe0c210]
- Updated dependencies [62cb9e6]
- Updated dependencies [fe0c210]
- Updated dependencies [57981c8]
- Updated dependencies [fe0c210]
- Updated dependencies [fe0c210]
- Updated dependencies [869d7d5]
- Updated dependencies [7164d54]
- Updated dependencies [c268256]
- Updated dependencies [cd494f0]
  - @codeforamerica/blueprint-core@0.3.0
  - @codeforamerica/blueprint-explorer@0.2.1

## 0.3.0

### Minor Changes

- 15e4b60: **Breaking:** Annotation files key fields by spec-relative path
  (`application.members[].dateOfBirth`) rather than schema-relative path
  (`member.dateOfBirth`). The first segment is the camelCase schema name,
  followed by the dot-bracket field path. This matches the data dictionary and
  the field inventory, so one path form works across all three.
- f45d4e9: `blueprint-build-explorer` is a new CLI for building the Blueprint Explorer static site from a resolved contracts directory.
- ef157e9: `blueprint-evaluate` is a new CLI for running rules from the command line.
  Pass a compiled graph, a rules file, or a rules examples file to evaluate
  every ruleset and example and return per-example results as JSON. (#425)
- ef157e9: The TypeScript client generator now emits a `Rules` export for domains with
  compiled graphs — `domain.Rules.<ruleset>.evaluate(inputs)` runs the graph in
  the browser with no network call, typed by `${Ruleset}Inputs` and
  `${Ruleset}Result`. Requires `@codeforamerica/blueprint-rules-engine` as a
  peer dependency. (#425)
- ef157e9: `blueprint-validate` now validates rules contracts, including cycle detection,
  unreachable node detection, and CEL expression syntax checking. (#425)
- a89ec45: **Breaking:** `blueprint-core` now has one entry point instead of seventeen
  subpaths. Import `discover`, `load`, `generate`, `extract`, `resolve`,
  `validate`, `schemasDir` and `baseContractsDir` from the package root;
  `/openapi`, `/rules`, `/validator`, `/overlay`, `/relationships`,
  `/compositions`, `/state-machines`, `/json-schema`, `/registries` and
  `/annotations` no longer resolve. `load` now takes a `DiscoveredFile`, so
  `discover(dir).map(load)` replaces
  `discover(dir).map((f) => load(f.path, f.relativePath))`. `Doc.refs` and
  `Doc.model` are methods rather than fields, because as fields they went stale
  as soon as a resolve pass rewrote `content`. OpenAPI loading and validation
  moved to `blueprint-mock-server`, annotation merging to `blueprint-explorer`,
  and `bundleSpec` to `blueprint-cli`. (#425)
- 2af7ed9: `blueprint-resolve --bundle` now preserves all standalone contract files in the bundled output — annotations, metrics, SLA types, mock data, policies, and rules examples are no longer incorrectly removed alongside shared component files.
- 0b64c26: `blueprint-resolve` now applies the `x-event-type-prefix` overlay config to annotation event keys, so resolved contracts stay consistent across all artifact types (state machine, AsyncAPI, and annotations).
- 15e4b60: `blueprint-explorer` is now a proper library. Each build tool is exported as a named function (`buildContextMap`, `buildDataDictionaries`, `buildApiReference`, etc.) from the package root so consumers can import and call them directly rather than spawning subprocesses into `src/`.
- Updated dependencies [15e4b60]
- Updated dependencies [a89ec45]
- Updated dependencies [15e4b60]
- Updated dependencies [d1a80d3]
- Updated dependencies [15e4b60]
- Updated dependencies [0be0fe7]
  - @codeforamerica/blueprint-core@0.2.0
  - @codeforamerica/blueprint-explorer@0.2.0

## 0.2.3

### Patch Changes

- 391e5f7: `blueprint-generate-ts-clients` now works reliably from a clean checkout. Previously, a cold npx cache caused the generator to download `@hey-api/openapi-ts@latest` instead of the pinned version, which crashed on startup with a `TypeError`. (#439)

## 0.2.2

### Patch Changes

- c92831b: `api:new` and `api:update` now pluralize resource names correctly — scaffolding `Child` produces `/children`, `listChildren` and the `Children` tag instead of `childs` — and they generate a `<Resource>Writable` base schema that the Create and Update request bodies extend, so server-managed fields like `id`, `createdAt` and `updatedAt` no longer appear in request payloads. (#378)

## 0.2.1

### Patch Changes

- 6f440c3: `blueprint-resolve` now exits with a clear error if `blueprint-core`'s base contracts are missing, rather than silently producing broken output. The `base-contracts/` and `assets/` directories are now correctly included in the `blueprint-core` npm package, fixing resolution failures for consumers who installed from npm.
- Updated dependencies [6f440c3]
  - @codeforamerica/blueprint-core@0.1.1

## 0.2.0

### Minor Changes

- 55f7e9e: `blueprint-export-schemas` is a new CLI that exports OpenAPI component schemas as standalone JSON Schema files, organized by domain — useful when downstream tooling needs JSON Schema without the full OpenAPI spec.
