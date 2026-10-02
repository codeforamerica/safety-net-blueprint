---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** `blueprint-mock` no longer accepts `--uploads` and ignores `MOCK_UPLOADS_DIR`, since no files are written. `startMockServer(specDirs, seedDir, storeKind)` drops its `uploadsDir` parameter, which was the third of four. (#448)
