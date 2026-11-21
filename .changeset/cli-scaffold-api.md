---
"@codeforamerica/blueprint-cli": patch
---

Before, `blueprint-scaffold-api --name=menu` was refused as an unknown argument, and a resource named `MenuItem` came out as schema `Menuitem` at `/menuitems`, with refs to a local `./components` folder and servers that didn't include the domain. Now it takes `--name=menu` as the other tools do, keeps `MenuItem` and serves it at `/menu-items`, refers to the framework's shared components, and serves the API under its domain, so its output validates as generated. `blueprint-add-api-resource` refers to the shared components the same way. (#534)
