---
"@codeforamerica/blueprint-core": patch
---

A polymorphic reference that declares `style: links-only` now gets a `links` entry in the resolved schema, where before resolve left it alone; the set's style still doesn't reach one, and `expand` still leaves it alone. Suggestion evidence declares it, so each entry's `links.source` says where to read what it cites. (#517)
