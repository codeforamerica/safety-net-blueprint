---
"@codeforamerica/blueprint-cli": patch
---

Before, `--env-variables` merged the whole environment over the file, so any `${VAR}` in a contract could pick up a machine value — `${HOME}` resolved to a developer's home directory. Now the file declares which variables exist and the environment supplies values only for those; an undeclared one is reported as unresolved. Declare it in the file if you were relying on it. (#464)
