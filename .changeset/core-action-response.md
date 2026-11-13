---
"@codeforamerica/blueprint-core": minor
---

Before, an action's endpoint always answered with its record, and `schema.response` could only describe a different answer that nothing gave. Now an action can say what it answers with, as `response: {schema, payload}`, which the generated endpoint declares; `schema.response` is deprecated, with a warning. (#520)
