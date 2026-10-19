---
"@codeforamerica/blueprint-core": patch
---

Before, `validate` checked an annotation's fact keys only against compiled graphs in the set, so `blueprint-resolve`, which validates before compiling them, passed an annotation naming a fact no ruleset declares. Now it reads each ruleset's facts from its rules document.
