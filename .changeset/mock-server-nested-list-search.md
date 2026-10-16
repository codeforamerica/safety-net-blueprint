---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a nested list such as `/applications/{applicationId}/members` ignored `q` and returned every record under its parent. Now it searches with `q` the same way a top-level list does.
