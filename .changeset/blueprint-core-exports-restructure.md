---
"@codeforamerica/blueprint-core": major
"@codeforamerica/blueprint-cli": minor
"@codeforamerica/blueprint-mock-server": minor
"@codeforamerica/blueprint-explorer": minor
"@codeforamerica/blueprint-rules-engine": minor
---

Collapse blueprint-core to a single entry point.

The package exported 17 subpaths. It now exports one, `.`, and everything
reachable through it describes the contract pipeline:

```js
discover(dir, type?)                    find contract files
load(file)                              parse one into a Doc
generate(docs)                          derive overlays and graphs
resolve(docs, { overlays, envTarget, envVariables })
validate(docs)
schemasDir, baseContractsDir
```

**Breaking.** Every subpath import must become an import from the package
root — `@codeforamerica/blueprint-core/openapi`, `/rules`, `/validator`,
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
`validate` checking pre-resolution documents.

**Moved out of core, to the package that wanted them:**

| what | where |
|---|---|
| OpenAPI spec loading and the server's runtime view of a spec | blueprint-mock-server |
| OpenAPI structural validation, example-data validation | blueprint-mock-server |
| annotation merging, contract navigation for docs generation | blueprint-explorer |
| `bundleSpec` | blueprint-cli |

**blueprint-rules-engine no longer depends on blueprint-core.** `toGraph`,
`toGraphWithFactGraph` and `toFactGraphXml` take a compiled graph; they no
longer accept a rules contract and compile it. Compile with `generate` (or
`compileRuleset`) and pass the graph. The browser bundle drops the stub that
existed only to keep core out of it.

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

Eleven further names remain on the entry point — `registryEntries`,
`registryTypes`, `compileRuleset`, `generateStateSchemas`,
`collectionToSchemaPrefix`, `extractIndividualResources`, `buildEndpointIndex`,
`extractRefName`, `loadExternalRefs`, `resolveExternalDefRef` and `detectType`.
Each is there only because core uses it internally *and* two or more other
packages need the same answer, so it can neither move out nor be dropped.
They are reads over a loaded document set, not pipeline stages, and are
candidates for removal.
