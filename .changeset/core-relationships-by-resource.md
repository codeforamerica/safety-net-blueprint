---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** `extract(docs, 'relationships')` keys a state machine action by its machine's resource as well, as `state-machine-action:intake:Application:close`, so two machines in a domain can each have a `close`; each entry also gives the `file` its endpoint is in, and that file's `api`.
