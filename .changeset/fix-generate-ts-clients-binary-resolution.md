---
"@codeforamerica/blueprint-cli": patch
---

`blueprint-generate-ts-clients` now works reliably from a clean checkout. Previously, a cold npx cache caused the generator to download `@hey-api/openapi-ts@latest` instead of the pinned version, which crashed on startup with a `TypeError`. (#439)
