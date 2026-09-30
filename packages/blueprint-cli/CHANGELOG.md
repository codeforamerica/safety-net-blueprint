# @codeforamerica/blueprint-cli

## 0.3.0

### Minor Changes

- 15e4b60: **Breaking:** Annotation files must now key fields by spec-relative path
  (`application.members[].dateOfBirth`) rather than schema-relative path
  (`member.dateOfBirth`). The first segment is the camelCase schema name — for
  example `application`, `verification`, `applicationWritable` — followed by the
  dot-bracket field path.
  
  This aligns annotation keys with the data dictionary and the field inventory,
  so a field can be looked up directly in any of them without translating
  between path forms.
- f45d4e9: `blueprint-build-explorer` is a new CLI for building the Blueprint Explorer static site from a resolved contracts directory.
- ef157e9: `blueprint-evaluate` is a new CLI for evaluating rules from the command line. Pass a compiled graph (`*-graph.yaml`), a rules file (`*-rules.yaml`, compiled on the fly), or a rules examples file (`*-rules-examples.yaml`) to run all rulesets and examples in batch and return per-example results as JSON.
- ef157e9: The TypeScript client generator now includes a `Rules` export for domains with compiled rule graphs (`*-graph.yaml`). `domain.Rules.rulesetName.evaluate(inputs)` runs the graph locally in the browser with no network call. Each ruleset gets fully typed inputs and results — `${Ruleset}Inputs` and `${Ruleset}Result` are exported from the domain client package alongside the API functions and types. Requires `@codeforamerica/blueprint-rules-engine` as a peer dependency when rules are used.
- ef157e9: `blueprint-validate` now validates rules contracts, including cycle detection, unreachable node detection, and CEL expression syntax checking.
- a89ec45: **Breaking:** `blueprint-core` is now imported from one entry point instead of
  seventeen subpaths, and every subpath import must be rewritten.
  
  The package exported 17 subpaths. It now exports one, `.`, carrying eight
  names — six pipeline stages and the two directories the package ships:
  
  ```js
  discover(dir, type?)        find contract files, with their type and domain
  load(file)                  parse one into a Doc
  generate(docs, type, opts?) derive 'overlay' | 'graph' | 'postman' | 'examples'
  extract(docs, type, opts?)  read out a stated fact: 'relationships'
  resolve(docs, { overlays, envTarget, envVariables })
  validate(docs)
  schemasDir, baseContractsDir
  ```
  
  `generate` makes what did not exist; `extract` surfaces what the documents
  already state. Both dispatch on a type string, as `discover(dir, type)` does.
  
  These subpaths no longer resolve: `@codeforamerica/blueprint-core/openapi`, `/rules`, `/validator`,
  `/overlay`, `/relationships`, `/compositions`, `/state-machines`,
  `/json-schema`, `/registries` and `/annotations` no longer resolve.
  
  `load` takes what `discover` returned rather than its parts:
  
  ```js
  - discover(dir).map((f) => load(f.path, f.relativePath))
  + discover(dir).map(load)
  ```
  
  `DiscoveredFile` and `Doc` both gain `domain`, derived from `info.x-domain`,
  then a top-level `domain`, then a path segment or filename prefix naming a
  value in the `Domain` enum. The last two need the whole set, which is why
  `discover` resolves it.
  
  `Doc.refs` and `Doc.model` are now methods. As fields they were computed once
  at load and went stale the moment a resolve pass rewrote `content`, which had
  `validate` checking pre-resolution documents. `refs()` entries also carry
  `name`, the schema name a reference points at, which replaces the former
  `extractRefName` export.
  
  **Moved out of core, to the package that wanted them:**
  
  | what | where |
  |---|---|
  | OpenAPI spec loading and the server's runtime view of a spec | blueprint-mock-server |
  | OpenAPI structural validation, example-data validation | blueprint-mock-server |
  | annotation merging, contract navigation for docs generation | blueprint-explorer |
  | `bundleSpec` | blueprint-cli |
  
  **blueprint-rules-engine no longer depends on blueprint-core.** `toGraph`,
  `toGraphWithFactGraph` and `toFactGraphXml` take a compiled graph; they no
  longer accept a rules contract and compile it. Compile with
  `generate(docs, 'graph')` and pass the graph. The browser bundle drops the
  stub that existed only to keep core out of it.
  
  Also fixed along the way:
  
  - `$ref` following was bounded by `process.cwd()`, so resolving the same
    contracts from a workspace directory silently dropped every cross-file ref
    and reported hundreds of fields as missing. It is bounded by the contract
    set now.
  - `discover` skips deprecated documents, which every caller was doing
    immediately afterwards anyway.
  - Resolve separates writing from succeeding: schema conformance still blocks
    the write, because it can only run before refs are rewritten, but every
    other failure writes the artifacts, reports, and exits non-zero.
  - State machine step walking had drifted into three copies of the same
    accessors. `Doc.model()` normalizes the authored shape — `then`/`else` on
    if, `when` on match, `do` on forEach — into uniform `{ kind, ...fields,
    children }` nodes, and the copies are gone. This fixed a silent defect: the
    old helper looked for a `forEach` body under `forEach.do` rather than the
    sibling `do`, so every loop body rendered empty in the generated state
    machine documentation.

### Patch Changes

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
