# @codeforamerica/blueprint-explorer

## 0.2.2

### Patch Changes

- 685f4ea: Before, a state machine's transitions were documented under its first machine's item path in the API its `apiSpec` named. Now each attaches to the resource it names, in whichever OpenAPI document of its domain declares it, so intake's Verification transitions appear under the verification. (#470)
- d833585: **Breaking:** Before, a state machine subscribed under `events:` and emitted full event names. Now it subscribes under `on:`, declares its resource's events once under `emits:` and sends them by name (`emit: claimed`), which resolve expands to `{domain}.{resource}.{event}`. (#470)
- Updated dependencies [685f4ea]
- Updated dependencies [3d96fc4]
- Updated dependencies [fcd12bf]
- Updated dependencies [685f4ea]
- Updated dependencies [f6e9cd2]
- Updated dependencies [3335c89]
- Updated dependencies [2da51d3]
- Updated dependencies [685f4ea]
- Updated dependencies [adfa5e1]
- Updated dependencies [d833585]
- Updated dependencies [9b934ac]
- Updated dependencies [f6e9cd2]
- Updated dependencies [f6e9cd2]
- Updated dependencies [4cc6217]
- Updated dependencies [9b19339]
- Updated dependencies [e5fe094]
- Updated dependencies [e5fe094]
- Updated dependencies [09aa7f4]
- Updated dependencies [c2df909]
- Updated dependencies [274c4e4]
- Updated dependencies [685f4ea]
- Updated dependencies [adfa5e1]
- Updated dependencies [6007c55]
- Updated dependencies [f031c70]
- Updated dependencies [9268474]
  - @codeforamerica/blueprint-core@0.4.0
  - @codeforamerica/blueprint-rules-engine@0.2.0

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
