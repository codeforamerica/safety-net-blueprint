---
"@codeforamerica/blueprint-rules-engine": minor
---

Before, the engine couldn't evaluate a fact once for each item of a list. Now it computes per-item facts, each node's `value` holding one entry per item and its `missing` naming what each unresolved item needs, and it refuses a graph whose `formatVersion` is later than `1.1`. (#496)
