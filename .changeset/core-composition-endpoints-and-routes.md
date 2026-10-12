---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** before, a composition with no `endpoint:` was silently never served, and nothing compared the paths rulesets, compositions, actions and OpenAPI operations chose. Now every composition must declare `endpoint: {path}`, a ruleset's or composition's path must be one or more segments with no trailing slash, and a well-formed URI template, and validation refuses any route two of them claim, naming both. (#470)
