---
"@codeforamerica/blueprint-mock-server": patch
---

Before, an event arriving while an action on the same record waited on a call could set off a reaction that changed the record mid-action, so both changes were made and both sent their events. Now the reaction waits for the action to finish, then reads the record as the action left it, with its `from` checked then. (#520)
