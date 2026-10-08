---
"@codeforamerica/blueprint-mock-server": minor
---

Before, `blueprint-mock` could only start from a contracts directory. Now `--spec=contracts.json` starts it from a bundled artifact, and seeding, reseed and mock-data validation all read from that file. (#448) Mock-data validation no longer requires an `x-derived` field of a seed record: the seed is what is stored, a derived field is computed at read time, so requiring it failed every record in a set that declared one. (#460)
