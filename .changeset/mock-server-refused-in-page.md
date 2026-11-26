---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a routed call a page couldn't make answered 502 with only the browser's "Failed to fetch". Now the message adds that the server may not allow calls from the page (CORS), or may be down or unreachable. (#543)
