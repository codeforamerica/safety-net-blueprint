---
"@codeforamerica/blueprint-explorer": minor
---

Before, showing what happens between a browser, a server and other services meant drawing a sequence diagram by hand. Now `@codeforamerica/blueprint-explorer/sequence` exports `createSequence(element, { participants })`, which draws the messages as they happen, each opening to what passed and to the names it uses, whose contract declarations show on hover. (#520)
