---
"@codeforamerica/blueprint-mock-server": minor
---

`blueprint-mock --spec=contracts.json` boots from a contracts artifact instead of walking a directory, so the server reads exactly the documents the artifact was built from. Seeding, reseed and mock-data validation all work from it — the same file a browser boots from. (#448)
