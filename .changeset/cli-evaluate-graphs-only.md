---
"@codeforamerica/blueprint-cli": minor
---

**Breaking:** `blueprint-evaluate` now takes only a compiled graph, `--spec=<*-graph.yaml>`, with `--input` or `--examples=<*-rules-examples.yaml>`; it no longer compiles a rules or rules examples file, which missed schemas in other files, and `--engine` is gone. It exits 1 when any fact comes back as an error.
