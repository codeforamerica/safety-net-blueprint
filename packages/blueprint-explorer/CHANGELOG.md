# @codeforamerica/blueprint-explorer

## 0.2.1

### Patch Changes

- Before, building an explorer for a contract set with no rule graphs ended the whole build at that tool and exited 0, so the API reference, event catalog, client reference and hub went unwritten while every caller recorded a success. Now the tool is skipped, the build continues, and the hub links a section only where one was generated.
- Uses @codeforamerica/blueprint-core 0.3.0.

## 0.2.0

### Minor Changes

- `blueprint-explorer` is now a proper library. Each build tool is exported as a named function (`buildContextMap`, `buildDataDictionaries`, `buildApiReference`, etc.) from the package root so consumers can import and call them directly rather than spawning subprocesses into `src/`.
- The Explorer now generates a documentation page per ruleset, with the
  dependency graph drawn and every fact evaluable in the browser. (#425)
- **Breaking:** Annotation files key fields by spec-relative path
  (`application.members[].dateOfBirth`) rather than schema-relative path
  (`member.dateOfBirth`). The first segment is the camelCase schema name,
  followed by the dot-bracket field path. This matches the data dictionary and
  the field inventory, so one path form works across all three.
