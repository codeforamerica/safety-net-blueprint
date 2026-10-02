---
"@codeforamerica/blueprint-core": patch
---

A document in `domains/<name>/` now reports that domain even when the contract set's `Domain` enum does not list it. Previously such a document had no domain unless it named one itself, which split a domain in half — `scheduling-openapi.yaml` carried `x-domain` and `scheduling-mock-data.yaml` carried nothing. Documents in `base/` and `common/` are still domainless, as they are shared across domains. (#448)
