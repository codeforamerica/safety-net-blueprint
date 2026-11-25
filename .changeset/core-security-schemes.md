---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** Before, no domain API stated how callers sign in. Now resolve makes every domain API require the shared schemes in `base/components/security-schemes.yaml`, whose default is `callerId` (the `X-Caller-Id` header) in place of `bearerAuth`. A state overlays it with its real sign-in, `x-caller` on a scheme names the claims that identify the caller, an operation that names `callerId` gets the environment's schemes (the transcription session adapter's `requestCredentials`), and validation reports a hand-written top-level `security` in a domain API as an error. (#473)
