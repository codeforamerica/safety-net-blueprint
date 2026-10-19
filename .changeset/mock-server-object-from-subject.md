---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** Before, a subscription without `transition:` got the event's payload as `$object` when the payload's `id` matched the event's `subject`. Now `$object` is the machine's own record, looked up by `subject`, and only for an event about the machine's own resource. (#463)
