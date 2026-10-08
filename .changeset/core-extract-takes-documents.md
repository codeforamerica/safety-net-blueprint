---
"@codeforamerica/blueprint-core": minor
---

Before, reading a state machine, SLA type set, metric, config or registry out of a contract set meant locating the documents and merging them yourself, and a cross-file `$ref` was read off disk. Now `extract(docs, type)` reads `'state-machines'`, `'sla-types'`, `'metrics'`, `'config'` and `'registries'` — `extract(docs, 'registries').policies` returns the policies registry, merged across every document that contributes to it — and refs resolve against the documents you passed in. (#448)
