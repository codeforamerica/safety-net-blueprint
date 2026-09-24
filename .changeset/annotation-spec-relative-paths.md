---
"@codeforamerica/blueprint-core": patch
"@codeforamerica/blueprint-cli": minor
"@codeforamerica/blueprint-explorer": patch
---

**Breaking:** Annotation files must now key fields by spec-relative path
(`application.members[].dateOfBirth`) rather than schema-relative path
(`member.dateOfBirth`). The first segment is the camelCase schema name — for
example `application`, `verification`, `applicationWritable` — followed by the
dot-bracket field path.

This aligns annotation keys with the data dictionary and the field inventory,
so a field can be looked up directly in any of them without translating
between path forms.
