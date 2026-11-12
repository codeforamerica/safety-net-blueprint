---
"@codeforamerica/blueprint-mock-server": minor
---

Before, a call to an operationId two APIs declare went to whichever the mock read first, and an Arazzo step qualified by its source could run another API's operation with the same id. Now a call can name one as `$apis.<api>.<id>`, a bare id more than one API declares is refused with 422 naming those forms, and a step runs the operation in its own source. (#520)
