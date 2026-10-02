---
"@codeforamerica/blueprint-mock-server": patch
---

The server no longer dereferences OpenAPI specs before reading them. It resolves each `$ref` against the contract set when something needs to see through one, which is why `@apidevtools/json-schema-ref-parser` is no longer used to load specs, and why the server now walks a contract directory once rather than twice. Schemas reach validation by the ref that named them, so ajv resolves cross-file refs itself. (#448)
