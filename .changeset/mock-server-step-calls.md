---
"@codeforamerica/blueprint-mock-server": minor
---

Before, a step's `call:` to a path with an id always ran an action, and an action's update steps were dropped. Now a call means what the API's route at that method and path means — a nested create, an update, or an action — and a path that means nothing is an error naming it. (#470)
