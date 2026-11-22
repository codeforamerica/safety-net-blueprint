---
"@codeforamerica/safety-net-contracts": minor
---

**Breaking:** client-management is served under `/client-management`, as every other API is under its domain: `http://localhost:1080/client-management/persons`, not `http://localhost:8080/persons` (which nothing served). The eligibility adapter's local server is `http://localhost:1080`, where `blueprint-mock` answers it, named "Local development server", and its hosted one "Production server", as every other API names them. (#543)
