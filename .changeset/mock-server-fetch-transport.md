---
"@codeforamerica/blueprint-mock-server": minor
---

Before, reaching mock behavior meant starting a server and sending it an HTTP request. Now every endpoint is a `(Request) => Response` function in a route table — exported from `./routes`, returned by `startMockServer`, and wrapped as a single `fetch` by `createMockServer({ contracts })` on the new `./browser` export, which runs the whole mock in a page, with `basePath` for one served from a subdirectory. Because that is `fetch`'s own signature, pointing one endpoint at a real service is `routes.get('POST /x').handler = fetch`. (#448)
