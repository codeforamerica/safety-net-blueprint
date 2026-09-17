---
"@codeforamerica/blueprint-cli": minor
---

`blueprint-resolve --bundle` now preserves all standalone contract files in the bundled output — annotations, metrics, SLA types, mock data, policies, and rules examples are no longer incorrectly removed alongside shared component files.

`blueprint-build-explorer` is a new CLI for building the Blueprint Explorer static site from a resolved contracts directory.
