---
"@codeforamerica/blueprint-core": patch
---

Before, an actor role missing from `RoleType` was reported as `Invalid actor role`, which read like a broken contract. Now the message says roles are added by an overlay on `RoleType`, and that a package's contracts need the package's own overlays applied. (#478)
