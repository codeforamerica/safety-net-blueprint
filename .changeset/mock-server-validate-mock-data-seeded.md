---
"@codeforamerica/blueprint-mock-server": patch
---

Before, `validate-mock-data` reported a record whose relationship the contracts expand as having an unknown property when the record it pointed at was seeded from config, such as a transcript's profile, though the server booted on it fine. Now it seeds first and checks records as the server serves them. (#469)
