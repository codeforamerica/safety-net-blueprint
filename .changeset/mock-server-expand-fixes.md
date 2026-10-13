---
"@codeforamerica/blueprint-mock-server": patch
---

Before, an expanded relationship kept its foreign key even where the resolved schema drops it, and a related record served at a path not matching its name, like `TranscriptionProfile` at `/profiles`, was never found. Now the response follows the resolved schema, the related record is found wherever its API serves it, and a new mock server starts with no stubs left from an earlier one. (#470)
