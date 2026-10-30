---
"@codeforamerica/blueprint-mock-server": minor
---

A scenario can now be split into sections, one workflow each: a workflow that `dependsOn` earlier ones runs after them, on the same mock, and reads what they produced as `$workflows.<id>.outputs.<name>`. When one it depends on fails, it fails without running. (#469)
