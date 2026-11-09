---
"@codeforamerica/blueprint-mock-server": minor
---

Before, a page that needed a second server, such as a stand-in for a state's backend, had to build another mock in the page, where it shared the first one's event reactions. Now `@codeforamerica/blueprint-mock-server/worker` runs one in a web worker, by Comlink's `expose` and `wrap`: `expose({ fetch: mock.fetch })` in the worker, and `wrap(worker)` in the page gives a server whose `fetch` streams its responses back and whose `connect(name)` opens a channel. (#520)
