---
"@codeforamerica/blueprint-cli": minor
---

`blueprint-build-mock-page --spec=<dir> --out=<dir>` builds a page that runs the mock server in a browser, with no server. It writes `index.html` + `mock.js` + `contracts.json` for serving over http(s), and `standalone.html` as a single file that works from `file://`, where fetching a sibling file is blocked. The page reads the route table the mock builds, so it demonstrates whatever contract set it is given and disables what the set does not declare. (#448)
