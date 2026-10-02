---
"@codeforamerica/blueprint-cli": minor
---

Before, booting the mock server meant pointing it at a contracts directory for it to walk. Now `blueprint-bundle-contracts --spec=<dir> --out=contracts.json` writes the set to one JSON file that `blueprint-mock --spec=contracts.json` or a browser can boot from, with `--domain=<name>` to include a single domain. (#448)
