---
"@codeforamerica/blueprint-mock-server": patch
---

The create and update handlers no longer carry code for `onCreate:` and `onUpdate:` triggers, which the state machine schema dropped in favor of reactions to the resource's own `created` and `updated` events. No valid contract could reach it, so nothing a mock does changes.
