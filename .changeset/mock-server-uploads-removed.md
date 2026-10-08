---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** before, `blueprint-mock --uploads=<dir>` and `MOCK_UPLOADS_DIR` chose where uploaded files were written. Now no files are written: both are gone, and `startMockServer(specDirs, seedDir, storeKind)` drops the `uploadsDir` parameter that was third of four. (#448)
