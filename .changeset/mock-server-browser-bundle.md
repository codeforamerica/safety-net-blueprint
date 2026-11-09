---
"@codeforamerica/blueprint-mock-server": minor
---

The package now includes a prebuilt browser build, `dist/blueprint-mock-server.esm-browser.js`: one ES module with its dependencies inside and their licenses and notices at the end, so a page can use the mock without bundling it. Before, every page had to bundle `/browser` itself and collect those notices on its own. (#520)
