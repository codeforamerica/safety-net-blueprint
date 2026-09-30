# @codeforamerica/blueprint-explorer

## 0.2.0

### Minor Changes

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
- 15e4b60: `blueprint-explorer` is now a proper library. Each build tool is exported as a named function (`buildContextMap`, `buildDataDictionaries`, `buildApiReference`, etc.) from the package root so consumers can import and call them directly rather than spawning subprocesses into `src/`.
- 0be0fe7: The Explorer now generates a documentation page per ruleset, with the
  dependency graph drawn and every fact evaluable in the browser. (#425)
- 15e4b60: **Breaking:** Annotation files key fields by spec-relative path
  (`application.members[].dateOfBirth`) rather than schema-relative path
  (`member.dateOfBirth`). The first segment is the camelCase schema name,
  followed by the dot-bracket field path. This matches the data dictionary and
  the field inventory, so one path form works across all three.
