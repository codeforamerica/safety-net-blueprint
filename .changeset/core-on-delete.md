---
"@codeforamerica/blueprint-core": minor
---

`x-relationship` now takes `onDelete: cascade`, following OData's `OnDelete`, to say a record is deleted with the record its field names; any other value fails validation. (#516)
