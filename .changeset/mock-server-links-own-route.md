---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a `links-only` link was built under the API holding it, so a determination linked to `/eligibility/applications/<id>` and a member to `/intake/application-members/<id>`. Now a link points at the related record's own route, parent ids filled in, and is left out when no loaded API serves it. (#481)
