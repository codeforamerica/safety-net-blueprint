---
"@codeforamerica/blueprint-safety-net-contracts": patch
---

Before, fields that may be null were marked `nullable: true`, which validators implementing OpenAPI 3.1 ignore, so they refused the null. Now those fields are typed `[<type>, "null"]`. (#461)
