---
"@codeforamerica/blueprint-core": minor
---

`extract` and `generate` can now run in a browser, from the new `./browser` export — importing them from `.` pulls in `discover` and `load`, so a bundler fails on their `fs` imports before it can tree-shake them away. `generate(docs, 'artifact')` reduces a contract set to one serializable object and `extract(artifact, 'docs')` reads it back as documents, methods and all, so a page gets the same `Doc[]` that `discover(dir).map(load)` produces in Node. (#448)
