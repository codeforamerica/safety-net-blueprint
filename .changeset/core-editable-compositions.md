---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-mock-server": minor
---

Before, changing an application and its members together took one request per record. Now a composition with `compositeType: editable` takes a JSON Patch (RFC 6902) at its endpoint, applied all or nothing through each record's own operations. (#516)
