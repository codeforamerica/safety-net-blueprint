---
"@codeforamerica/blueprint-core": minor
---

The SLA schemas are now defined in `base/schemas/sla.yaml`, with `base/components/sla.yaml` referring to them as before, and there's a new `SlaDeadline`: the earliest deadline among a record's running SLA clocks, null when none is, which a record with `slaInfo` may declare as `slaDeadline`. (#516)
