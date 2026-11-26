---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** an `x-derived` expression reads the record as `object`, as a guard does, and validation refuses one that reads `this`, which elsewhere names the event a reaction handles. Where you wrote `x-derived: "this.id"`, write `x-derived: "object.id"`.
