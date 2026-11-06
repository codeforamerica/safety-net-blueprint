---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** Where a field declares `resource: Polymorphic`, name its type field in `discriminator.propertyName` and make that field an enum whose values name resources, or validation fails. A set including transcripts or suggestions gives their type fields values by overlay. (#516)
