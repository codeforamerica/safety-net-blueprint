---
"@codeforamerica/blueprint-cli": minor
---

Adds `blueprint-generate-asyncapi`, a new CLI that generates AsyncAPI files from state machine contracts. The state machine is the source of truth for which events a domain emits — the generator reads all emit steps and produces one channel per event type. For emit steps with a `data:` block, it resolves field types from the OpenAPI spec and generates a typed `*Data` schema automatically, so payload schemas stay in sync with the contracts rather than being hand-authored. On subsequent runs, existing channels are preserved while new ones are added.

Also fixes `blueprint-resolve` to apply the `x-event-type-prefix` overlay config to annotation event keys (in addition to state machine and AsyncAPI files already covered), so resolved contracts stay consistent across all artifact types.
