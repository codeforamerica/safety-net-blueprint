---
"@codeforamerica/blueprint-safety-net-contracts": minor
---

**Breaking:** intake's composition filters read each record as `item`, such as `'primary_applicant' in item.roles`; the records they return are unchanged. An overlay that replaces one of these filters writes it the same way.
