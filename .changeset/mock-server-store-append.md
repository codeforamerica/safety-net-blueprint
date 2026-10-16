---
"@codeforamerica/blueprint-mock-server": minor
---

Before, a store could only save a record through `create` or `insertResource`, both of which add `createdAt` and `updatedAt`, and `restore()` added them to snapshotted records that had none. Now a store implements `append(collection, record)`, which saves a record exactly as given, and `restore()` writes each record as the snapshot has it; a custom store without `append` keeps working. (#470)
