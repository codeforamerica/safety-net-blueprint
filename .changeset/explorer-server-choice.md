---
"@codeforamerica/blueprint-explorer": minor
---

Before, every call from a built explorer was answered in the page, or went where the site's script routed it. Now the control panel's "Where calls go" lets the reader choose a server for the tab, as Swagger's server list does: an environment the contracts' `servers` name, sending each API to its own server for it, or a URL typed in, taking every call. The site's own routing still wins, and Scenarios asks before running against a server that isn't local. (#543)
