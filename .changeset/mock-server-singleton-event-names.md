---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** a singleton's events are now named for the schema its path returns, in snake_case, as every other resource's are, not for its path. Intake's `/applications/{applicationId}/household-info` returns `ApplicationHousehold`, so its updates are `intake.application_household.updated`, not `intake.household-info.updated`. Subscribe to the new name. (#492)
