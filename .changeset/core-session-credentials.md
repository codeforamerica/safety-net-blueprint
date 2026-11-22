---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** A transcription session asks its adapter for credentials itself: the session's `get-connection` and `renew-connection` are `request-credentials` and `renew-credentials`, and a transcript's `get-connection` is removed. The transcript audio adapter is the transcription session adapter (`communication-transcription-sessions-adapter-openapi.yaml`), with `requestCredentials` at `POST /credentials`, which requires a sign-in token, and `getCredentialKeys`, in place of `issueTranscriptConnection` and `getTranscriptConnectionKeys`. (#548)
