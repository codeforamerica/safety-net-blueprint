---
"@codeforamerica/blueprint-cli": minor
---

`blueprint validate --routing=<file>` checks a routing file against the contracts too, and that each handler module it names exists. A built explorer whose `config.yaml` names `routing:` has it checked and bundled, with its handler modules, failing the build when it's wrong. (#549)
