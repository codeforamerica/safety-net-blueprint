# @codeforamerica/blueprint-explorer

## 0.2.1

### Patch Changes

- cd494f0: Before, building an explorer for a contract set with no rule graphs ended the whole build at that tool and exited 0, so the API reference, event catalog, client reference and hub went unwritten while every caller recorded a success. Now the tool is skipped, the build continues, and the hub links a section only where one was generated.
- Updated dependencies [fe0c210]
- Updated dependencies [62cb9e6]
- Updated dependencies [fe0c210]
- Updated dependencies [57981c8]
- Updated dependencies [fe0c210]
- Updated dependencies [fe0c210]
- Updated dependencies [869d7d5]
- Updated dependencies [7164d54]
- Updated dependencies [c268256]
  - @codeforamerica/blueprint-core@0.3.0

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
