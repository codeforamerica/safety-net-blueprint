---
"@codeforamerica/blueprint-explorer": minor
---

Before, a site sent calls away from the mock in the page only from a script of its own. Now `routing:` in `config.yaml` names a routing file, which the build checks against the contracts and bundles, with the handler modules it names and whatever they import, into a script every page loads; esbuild is now a dependency. (#549)
