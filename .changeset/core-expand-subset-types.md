---
"@codeforamerica/blueprint-core": patch
---

Before, an expanded relationship's subset gave a field the type `string` when the related resource declared it in a part it references — the `Writable` half of `allOf: [$ref ApplicationWritable, …]` — so an expanded application's `programsAppliedFor`, a list, was described as a string, and a record carrying it was refused. Now the field keeps its declared type.
