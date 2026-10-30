---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a record an action's step created directly — `call: { POST: decision-support/suggestions, body: … }` — was stored with no `created` event, so nothing reacting to that event ran: a suggestion made that way never asked for its expiry timer. Now it sends the `created` event a create through the API would, naming whoever ran the action and caused by the action's event.
