---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** a composition's `filter:` reads each record as `item`, and validation refuses one that reads a field bare. Where you wrote `category == section.name`, write `item.category == section.name`.
