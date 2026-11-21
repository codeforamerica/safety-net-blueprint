---
"@codeforamerica/blueprint-safety-net-contracts": patch
---

Before, intake's reaction to `eligibility.determination.completed` asked to close the application, or route it for approval, whatever state it was in, and the call was refused unless it was under review. Now the reaction acts only on an application under review. (#534)
