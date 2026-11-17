---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** a singleton's events are now named for its schema in snake_case, as every other resource's are: `intake.household_info.updated`, not `intake.household-info.updated`. Subscribe to the new name. (#492)
