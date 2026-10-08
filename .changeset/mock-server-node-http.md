---
"@codeforamerica/blueprint-mock-server": minor
---

Before, installing the package brought in Express, `cors` and `multer`. Now the server runs on `node:http` and those are gone, with `express` remaining only for the optional `blueprint-swagger` bin. (#448)
