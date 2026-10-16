---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** Before, a subscription without `transition:` to an event about another resource passed validation while reading `$object`, which it doesn't have. Now that fails validation; read the record's id from `$this.subject` and what the event carries from `$this.data`. (#463)
