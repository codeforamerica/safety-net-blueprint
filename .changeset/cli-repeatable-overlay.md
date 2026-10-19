---
"@codeforamerica/blueprint-cli": minor
---

Before, `blueprint-resolve` took one `--overlay`, so applying a package's own overlays and then a state's meant copying them into one folder. Now `--overlay` can be given more than once and applies in the order given, and a second `--spec` is refused instead of silently replacing the first. (#478)
