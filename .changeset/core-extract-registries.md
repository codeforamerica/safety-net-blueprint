---
"@codeforamerica/blueprint-core": minor
---

`extract(docs, 'registries')` reads every registry in a contract set, grouped by the type each one claims — `extract(docs, 'registries').policies` for the policies registry. Entries merge across documents with the later winning, so an overlay can add to a registry it did not author, and no `domain` is required, since the platform registries this was written for are cross-domain. (#448)
