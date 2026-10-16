---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** Before, a composition with no `endpoint:` was silently never served. Now every composition must declare `endpoint: {path}`, a well-formed path with no trailing slash, and validation refuses a route that two rulesets, compositions, actions or operations claim, naming both. (#470)
