---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-safety-net-contracts": minor
---

The event log's stream now sends each event's `id`, sends a reader that reconnects with `Last-Event-ID` what it missed (`410` when the log no longer has it), takes listing's `type`, `source` and `subject` filters, and describes each message as an `Event`; a server that can't stream may answer `501`, and readers then poll the list. (#520)
