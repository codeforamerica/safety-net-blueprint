---
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** Before, a state machine value expression that found nothing filled in null — in a call's body, an event's data, a `set:` — and a null went out even where the schema it went into didn't accept one. Now what finds nothing is left out, so a `set:` sets nothing and a PATCH leaves the field as it was, and a null is left out where its schema doesn't accept one; to clear a field, write a literal null. (#520)
