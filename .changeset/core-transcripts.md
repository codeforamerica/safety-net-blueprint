---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-cli": minor
---

A contract set can now include the framework's transcripts by listing the `transcripts` capability in `x-capabilities`: `/communication/transcripts` records transcripts under a profile from `/communication/profiles`, with their timeline at `/transcripts/{id}/entries`, and validation names the capability when a set refers to one it hasn't listed. A new `x-enum-source: { registry: <type> }` form draws an enum from a registry. (#470, #469)
