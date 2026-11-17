---
"@codeforamerica/blueprint-mock-server": patch
---

Before, two domains with a collection of the same name, such as `/ordering/settings` and `/dispatch/settings`, read and wrote the same records. Now each domain keeps its own, and a store names a collection by its domain and path (`intake/applications`, `intake/applications/members`), as the README's example of using a store directly now shows. (#534)
