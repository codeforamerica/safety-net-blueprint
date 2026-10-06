---
"@codeforamerica/blueprint-explorer": patch
---

Before, building an explorer for a contract set with no rule graphs ended the whole build at that tool and exited 0, so the API reference, event catalog, client reference and hub went unwritten while every caller recorded a success. Now the tool is skipped, the build continues, and the hub links a section only where one was generated.
