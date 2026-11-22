---
"@codeforamerica/blueprint-core": minor
---

Before, `x-relationship` with `style: expand` replaced a foreign key with the record it named, so a response had `profile` but no `profileId`. Now the key stays beside the record, so a client or a state machine step finds the id under the same name whatever the style. (#548)
