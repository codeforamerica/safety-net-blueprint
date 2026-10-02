---
"@codeforamerica/blueprint-core": patch
---

Before, a document in `domains/scheduling/` had no domain unless it declared one itself, so `scheduling-openapi.yaml` was in the scheduling domain and `scheduling-mock-data.yaml` was in none. Now the directory name supplies it; `base/` and `common/` stay domainless. (#448)
