---
"@codeforamerica/blueprint-mock-server": minor
---

The server runs on `node:http` instead of Express, so `cors` and `multer` are no longer installed. `express` remains a dependency of the optional `blueprint-swagger` bin only. (#448)
