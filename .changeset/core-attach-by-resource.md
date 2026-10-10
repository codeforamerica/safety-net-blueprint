---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-mock-server": patch
"@codeforamerica/blueprint-explorer": patch
---

Before, a state machine's transitions were documented under its first machine's item path, in the API its `apiSpec` named, and a composition patched the document named after its file. Now each attaches to the resource it names, in whichever OpenAPI document of its domain declares it (read from `model()`, which now describes an OpenAPI document's servers and resources, and reported by `extract` as each entry's `api` and `resource`), so intake's Verification transitions are documented under the verification. (#470)
