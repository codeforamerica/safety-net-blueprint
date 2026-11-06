---
"@codeforamerica/blueprint-core": minor
---

Before, a contract couldn't say what deleting a record does to the records that name it. Now `x-relationship` takes `onDelete: cascade`, following OData's `OnDelete`, to delete them with it. (#516)
