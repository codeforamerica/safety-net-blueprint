---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** Before, the mock identified callers by `X-Caller-Id` and `X-Caller-Roles`, or a token's `userId`, and kept an event's `authid` and `authtype` as its publisher sent them. Now it reads the caller the way the contract set's scheme says, from the claims its `x-caller` names, falling back to the headers, and sets a published event's `authid` and `authtype` from the caller. Run as a server, it refuses a token that doesn't verify against an OpenID Connect provider's keys with 401. (#473, #548)
