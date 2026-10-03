---
"@codeforamerica/blueprint-core": patch
---

Before, a `${VAR}` placeholder in an overlay's `config:` block was used verbatim — `x-event-type-prefix: ${EVENT_PREFIX}` prefixed every event type with that literal text, silently. Now config values are substituted like the rest of the contract set, so a cross-cutting setting can vary by environment, and `resolve()` reports the names of any placeholders that found no value. (#464)
