---
"@codeforamerica/blueprint-core": patch
---

`doc.externalRefs(docs)` resolves against the contract set's relative paths instead of joining and normalizing absolute filesystem paths, so it now behaves the same as `doc.resolveRef` and works where there is no filesystem. A document loaded on its own, with no `relativePath`, no longer resolves refs to its siblings. (#448)
