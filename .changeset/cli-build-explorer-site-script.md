---
"@codeforamerica/blueprint-cli": patch
---

`blueprint-build-explorer` copies the script `config.yaml` names along with `config.yaml` when `--config` is a different folder from `--out`, and fails naming the file when it isn't there. (#543)
