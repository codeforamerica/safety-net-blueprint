---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** a composition's `filter:` reads each record as `item`, as a metric filter and a `where:` do, and validation refuses one that reads a field bare, with the form to write. Where you wrote `category == section.name`, write `item.category == section.name`, and test for a field a record may not have with `has(item.field)`.
