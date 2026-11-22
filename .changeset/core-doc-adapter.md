---
"@codeforamerica/blueprint-core": minor
---

Before, an adapter was known only by its file name, or by `x-relationship: { type: external }` on each of its operations. Now that mark at an OpenAPI document's root makes the whole API an adapter, `doc.adapter` says so, and validation warns when a document is named an adapter and not marked one, or the reverse. (#548)
