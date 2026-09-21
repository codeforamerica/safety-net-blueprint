---
"@codeforamerica/blueprint-core": patch
"@codeforamerica/blueprint-cli": minor
"@codeforamerica/blueprint-explorer": patch
---

Annotation schema keys now use spec-relative paths (`application.members[].dateOfBirth`) rather than schema-relative paths (`member.dateOfBirth`). This aligns annotation key format with the data dictionary and field inventory, enabling direct lookup without path translation.

**Breaking:** `validateAnnotationPath` signature changed from `(pathKey, resourceSchemaMap)` to `(pathKey, domainSpecMap, annotationDomain)`. Replace `buildResourceSchemaMap` with `buildDomainSpecMap` at call sites. Annotation files must use spec-relative paths — the first segment is the camelCase schema name (e.g. `application`, `verification`, `applicationWritable`), followed by the dot-bracket field path.
