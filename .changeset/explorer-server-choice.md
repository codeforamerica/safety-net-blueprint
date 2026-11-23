---
"@codeforamerica/blueprint-explorer": minor
---

Before, every call from a built explorer was answered in the page, or went where the site's script routed it. Now the control panel's "Server" lets the reader choose a server for the tab, as Swagger's server list does: an environment the contracts' `servers` name, sending each API to its own server for it, or a URL typed in, taking every call. The site's own routing still wins, and Scenarios asks before running against a server that isn't local. A call sent to an environment carries only the headers its API's contract declares, with its security schemes', so the mock's own caller headers, such as `X-Caller-Id`, don't get it refused by the server's CORS. (#543)
