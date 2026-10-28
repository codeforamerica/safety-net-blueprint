---
"@codeforamerica/blueprint-core": minor
---

Before, an annotations file could cite the policies behind a ruleset's facts but not its constants, such as an hours threshold, or its inputs. Now a `constants:` section, keyed `{ruleset}.{constantName}`, and an `inputs:` section, keyed `{ruleset}.{input path}` (`medicaidWorkRequirements.months[].hoursWorked`), do. Validation reports a key naming a constant or input the ruleset doesn't declare.
