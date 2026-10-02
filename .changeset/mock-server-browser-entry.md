---
"@codeforamerica/blueprint-mock-server": minor
---

`createMockServer({ contracts })` from the new `./browser` export runs the mock in a page — same route table, same handlers, no HTTP and no filesystem. Hand it the output of `blueprint-bundle-contracts` and it returns a `fetch` with `fetch`'s own signature, so it can be called directly or replace `window.fetch`. (#448)
