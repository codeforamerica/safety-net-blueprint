---
"@codeforamerica/blueprint-explorer": patch
---

Before, a `config.yaml` naming a domain the contracts lack failed the build with only the domains present. Now the message also says that contracts resolved with `--domain` or `--capability` need a `config.yaml` of their own. (#543)
