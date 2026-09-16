---
"@codeforamerica/blueprint-cli": minor
---

`blueprint-validate` now validates rules contracts, including cycle detection, unreachable node detection, and CEL expression syntax checking. It also now accepts `--spec=<file|dir>` to validate a single file or directory without requiring the full resolved contracts directory — useful during development.
