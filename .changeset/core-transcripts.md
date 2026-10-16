---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-cli": minor
---

A contract set can now include the framework's `communication` capability by listing it in `x-capabilities`: `/communication/transcripts` records transcripts under a profile from `/communication/profiles`, with their timeline at `/transcripts/{id}/entries`. A new `x-enum-source: { registry: <type> }` form draws an enum from a registry. (#470)
