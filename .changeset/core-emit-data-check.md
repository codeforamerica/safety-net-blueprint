---
"@codeforamerica/blueprint-core": patch
---

Before, validation didn't compare the `data:` an emit step sends with the schema its event declares. Now a required property not sent, a property the schema doesn't declare when it allows no others, or data on an event that declares no schema is an `emit-data` error. (#469)
