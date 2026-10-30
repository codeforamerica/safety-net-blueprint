---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a record a procedure's step created directly — `call: { POST: intake/applications, body: … }` — started no SLA clocks, and its `created` event named the system as who acted, whatever ran the procedure. Now, in a procedure an action or a reaction runs, it's settled as a record created directly in the action or reaction is: its clocks start, and its `created` event names whoever ran it and is caused by the action's event, or the event reacted to.
