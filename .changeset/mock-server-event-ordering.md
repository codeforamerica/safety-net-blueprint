---
"@codeforamerica/blueprint-mock-server": minor
---

Before, a state machine's reactions to two quick changes to one application could run at the same time. Now each event carries a `partitionkey` — the application's id, for an income — and reactions to events with the same key run one at a time, in order. (#469)
