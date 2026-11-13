---
"@codeforamerica/blueprint-mock-server": patch
---

Before, two mocks in one page or process shared their event reactions, stubs and validators, so an event one sent ran the other's `on:` reactions and a stub registered on one answered the other. Now each mock keeps its own. (#520)
