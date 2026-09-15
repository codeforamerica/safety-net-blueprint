# @codeforamerica/blueprint-cli

## 0.2.1

### Patch Changes

- 6f440c3: `blueprint-resolve` now exits with a clear error if `blueprint-core`'s base contracts are missing, rather than silently producing broken output. The `base-contracts/` and `assets/` directories are now correctly included in the `blueprint-core` npm package, fixing resolution failures for consumers who installed from npm.
- Updated dependencies [6f440c3]
  - @codeforamerica/blueprint-core@0.1.1

## 0.2.0

### Minor Changes

- 55f7e9e: `blueprint-export-schemas` is a new CLI that exports OpenAPI component schemas as standalone JSON Schema files, organized by domain — useful when downstream tooling needs JSON Schema without the full OpenAPI spec.
