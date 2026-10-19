---
"@codeforamerica/blueprint-core": minor
---

Before, an annotations file could cite the policies behind a ruleset's facts but not its constants, such as an hours threshold. Now a `constants:` section, keyed `{ruleset}.{constantName}`, does, and validation reports a key naming a constant the ruleset doesn't declare.
