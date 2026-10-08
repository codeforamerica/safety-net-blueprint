---
"@codeforamerica/blueprint-core": patch
---

Before, `doc.externalRefs(docs)` and `doc.resolveRef` could disagree about the same ref, and `externalRefs` needed a filesystem to answer at all. Now both resolve against the set's relative paths — and a document loaded on its own, with no `relativePath`, no longer finds its siblings. (#448)
