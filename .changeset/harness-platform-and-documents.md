---
"@codeforamerica/blueprint-harness": patch
---

The sample contracts now declare a platform domain with an event log and a document-management domain with an upload endpoint, plus seed data for intake and eligibility. Event injection and document upload are selected by `operationId` in the mock server, so without those operations the fixture could not exercise them at all — and with no mock data every collection booted empty. (#448)
