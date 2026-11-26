---
"@codeforamerica/blueprint-explorer": minor
---

**Breaking:** The explorer no longer builds a Client Reference: `buildClientReference`, `--only=client-reference` and `--clients` are removed. Each operation on the API reference shows its TypeScript client call instead, and the annotation explorer shows the client's `Annotations` call. (#465)
