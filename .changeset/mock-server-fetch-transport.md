---
"@codeforamerica/blueprint-mock-server": minor
---

Mock behaviour is now reachable without running a server: every endpoint is a `(Request) => Response` function in a route table, exported from `@codeforamerica/blueprint-mock-server/routes` and returned by `startMockServer`. Because that is also `fetch`'s signature, pointing an endpoint at a real service is `routes.get('POST /x').handler = fetch` rather than an adapter. (#448)
