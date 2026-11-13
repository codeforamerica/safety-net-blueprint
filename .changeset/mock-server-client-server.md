---
"@codeforamerica/blueprint-mock-server": minor
---

Before, a page imported `createMockServer` from `@codeforamerica/blueprint-mock-server/browser`, and Node imported `startMockServer` from the package itself. Now both import from `/server`, which in Node also has `startMockServer`, and `/client` exports `createMockClient`, which runs the APIs a page keeps and sends everything else to the server, starting with no seeded records; `/browser` still works and is deprecated. (#520)
