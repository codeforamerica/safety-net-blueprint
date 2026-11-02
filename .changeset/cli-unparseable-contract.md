---
"@codeforamerica/blueprint-cli": patch
---

Before, `blueprint-resolve` skipped an overlay file that wasn't valid YAML and resolved without its changes, and a contract file that wasn't valid YAML was left out of `blueprint-validate`, `blueprint-resolve` and `blueprint-generate-postman-collection` without a word. Now each stops with one line naming the file and the line and column where it fails, and exits 1. (#469)
