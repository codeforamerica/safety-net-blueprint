---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** an `x-derived` expression is evaluated with the record as `object`, so one that reads `this`, such as `this.id`, no longer evaluates and its field is left out of responses; write `object.id`, as `blueprint-validate` shows.
