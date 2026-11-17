---
"@codeforamerica/blueprint-core": patch
---

Before, `extract(docs, 'examples')` left out, without a word, a record with an `items` array of its own and a record whose key contained "create", "update" or "payload". Now it leaves out only an example shaped as a list response (`items` with `total`, `limit` and `offset`) or one with no `id`, and warns naming each. (#449)
