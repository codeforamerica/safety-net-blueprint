---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** Validation now fails on `nullable: true`, which OpenAPI 3.1 removed; write `type: [<type>, "null"]`, or `anyOf: [{ $ref: ... }, { type: "null" }]` for a reference. (#461)
