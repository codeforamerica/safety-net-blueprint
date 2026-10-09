---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a request that failed validation in a browser came back as `500 INTERNAL_ERROR: process is not defined`. Now it returns the `422` naming the field, as it already did in Node. (#460)
