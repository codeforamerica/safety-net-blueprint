---
"@codeforamerica/blueprint-safety-net-contracts": patch
---

Before, the document upload's `documentTypeId` and `BackendAuthContext.userId` didn't say what they point at. Now they declare `x-relationship` to `DocumentType` and `User`. (#481)
