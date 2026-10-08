---
"@codeforamerica/blueprint-core": minor
---

Before, `extract` and `generate` only ran in Node, because importing either one pulled the filesystem in with it. Now the new `./browser` export runs them in a page: `generate(docs, 'artifact')` turns a contract set into one serializable object, `extract(artifact, 'docs')` turns it back into documents, and `{ domains: ['intake'] }` narrows it to the domains you name. (#448)
