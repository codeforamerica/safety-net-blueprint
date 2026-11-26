---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** The transcription relay contract (`communication-transcripts-relay-asyncapi.yaml`) is removed. For a service a browser can't reach, write a session adapter for it like any other, streaming to a server the state runs in front of the service. The shapes in `communication-transcripts-schema.yaml` are now in the session adapter's contract, without `subprotocol`; the adapter no longer publishes signing keys (`GET /.well-known/jwks.json`); and the framework's profiles no longer include `english-or-spanish`.
