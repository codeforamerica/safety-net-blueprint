---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a record an action's step created directly, with a `call:` by method and path, was stored with no `created` event, so nothing reacting to its creation ran. Now it sends the `created` event a create through the API would. (#469)
