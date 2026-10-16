---
"@codeforamerica/blueprint-core": patch
---

**Deprecated:** A state machine's `apiSpec` is ignored, and validation warns where it is still written, since each machine attaches to the resource in its domain named for its object. Remove it; it will be removed from the schema in a future minor version. (#470)
