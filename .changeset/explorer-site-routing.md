---
"@codeforamerica/blueprint-explorer": minor
---

Besides a `script`, a site can name a routing file with `routing:` in `config.yaml`, which the build checks against the contracts and bundles, with the handler modules it names and whatever they import, into a script every page loads; esbuild is now a dependency. (#549)
