---
"@codeforamerica/blueprint-cli": patch
---

Before, `blueprint-resolve` wrote output even when a `${VAR}` placeholder had no value, leaving the literal text in the artifacts — and validation passed, because an event type and the channel it names were given the same literal. Now resolve reports the unresolved names and exits without writing. (#464)
