---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a record created through the mock never started its SLA clocks: the only code that did ran for an `onCreate:` trigger, which the state machine schema no longer has. Now creating a record whose resource has a state machine starts the clocks of the SLA types its domain declares that it names in `slaInfo` or that assign themselves with `autoAssignWhen` — through the API, or written directly by a state machine's step in an action or a reaction — before its `created` event, which carries them. A record no SLA applies to is left without `slaInfo`. Each entry is returned, and carried in events, as the `SlaInfo` contract describes it: the engine's own tracking fields (`_pausedSince`, `_accumulatedPausedMs`) stay in the mock's store.
