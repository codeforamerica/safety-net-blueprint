---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a record created through the mock never started its SLA clocks. Now creating one starts the clocks of the SLA types that apply to it — through the API or by a state machine's step — and returns `slaInfo` as the `SlaInfo` contract describes it, without the engine's own tracking fields. (#469)
