---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** `generate(docs, 'examples')` is now `extract(docs, 'examples')`. The output is unchanged — example records grouped by the schema each exemplifies — but grouping records the documents already declare is a readout rather than a derivation, and `generate` now produces only artifacts the inputs do not contain. (#448)
