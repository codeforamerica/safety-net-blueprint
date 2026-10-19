---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** Before, a `call:` step written as `{ path:, method: }` passed validation and then silently did nothing. Now its object form must have exactly one method key (`POST`, `PATCH`, `GET` or `DELETE`, its value the path), with only `body` and `description` beside it. (#463)
