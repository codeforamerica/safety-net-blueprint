---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** before, uploading a document wrote its bytes to disk and `GET /document-versions/{id}/content` returned them. Now nothing is written and that endpoint returns a JSON object describing the file — name, type, size, hash, upload time — so a `snapshot()` can never carry real uploaded content. (#448)
