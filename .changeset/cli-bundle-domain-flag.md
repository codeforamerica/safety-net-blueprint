---
"@codeforamerica/blueprint-cli": patch
---

`blueprint-bundle-contracts --domain=<name>` bundles only that domain, repeatable, and reports what it kept. A name no document belongs to is an error listing the domains the set does have, rather than an artifact that is quietly almost empty. (#448)
