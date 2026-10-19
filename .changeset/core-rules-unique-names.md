---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** Validation now refuses a ruleset where a name would mean two things: a fact declared twice, a fact starting with an input's name, or a path that's both a fact and a group. (#481)
