---
"@codeforamerica/blueprint-mock-server": minor
---

`startScenario` runs an Arazzo scenario a step at a time on the same server, and a step can upload a file as `multipart/form-data`, with each part the operation declares as a file given as `{ fileName, contentType, content }`. (#470)
