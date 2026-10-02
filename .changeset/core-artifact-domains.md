---
"@codeforamerica/blueprint-core": minor
---

`generate(docs, 'artifact', { domains: ['intake'] })` builds an artifact for named domains only, following every `$ref` out of them so the result is self-contained. The platform domain always comes along, since the mock server seeds its registries whatever domain is being shown and nothing references them. Against the safety-net contracts, `intake` is 25 of 73 documents and 0.42 MB instead of 0.67 MB. (#448)
