---
"@codeforamerica/blueprint-cli": minor
---

Before, `blueprint-generate-ts-clients` always generated an SDK that sends requests with axios. Now `--http-client=fetch` generates one that uses `fetch` and takes a `fetch` of your own, such as the in-page mock server's; axios stays the default. (#520)
