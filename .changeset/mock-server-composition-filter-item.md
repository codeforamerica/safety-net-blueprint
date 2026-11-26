---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** a composition's `filter:` is evaluated with the record as `item`, so one that reads a field bare, such as `category == "identity"`, now returns nothing; write `item.category == "identity"`, as `blueprint-validate` shows.
