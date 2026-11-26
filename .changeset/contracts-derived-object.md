---
"@codeforamerica/blueprint-safety-net-contracts": minor
---

**Breaking:** the User resource's `userId` is derived as `object.id`; its value is unchanged. An overlay that replaces it writes it the same way.
