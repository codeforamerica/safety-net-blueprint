---
"@codeforamerica/blueprint-cli": minor
---

`blueprint-bundle-contracts --spec=<dir> --out=contracts.json` writes a contract set to one JSON file, for a browser to boot the mock server from or for `blueprint-mock --spec=contracts.json` to read without walking a directory. It validates the set first and refuses to write a broken one unless `--skip-validation` is passed. (#448)
