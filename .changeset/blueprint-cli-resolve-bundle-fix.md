---
"@codeforamerica/blueprint-cli": minor
---

`blueprint-resolve --bundle` now correctly preserves all standalone contract files (annotations, metrics, sla-types, mock-data, policies, rules-examples, etc.) and removes only shared component files (base/, common/) that have been inlined. Previously only OpenAPI, state machine, rules, compositions, and graph files were kept — all others were incorrectly deleted.

Also adds `blueprint-build-explorer`, a new CLI for building the Blueprint Explorer static site from resolved contracts.
