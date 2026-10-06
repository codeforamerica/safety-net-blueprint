---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** uploaded document bytes are no longer stored anywhere. `GET /document-versions/{id}/content` returns a JSON object describing the file — name, type, size, hash, upload time — instead of its contents, and nothing is written to disk, so a `snapshot()` can never carry real uploaded content. (#448)
