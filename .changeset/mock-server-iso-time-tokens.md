---
"@codeforamerica/blueprint-mock-server": patch
---

**Deprecated:** Where a seed file or a stub wrote `$now+7d`, `$now-8h`, `$now+30m` or `$now+1w`, write the ISO 8601 duration — `$now+P7D`, `$now-PT8H`, `$now+PT30M`, `$now+P1W` — which also takes months and years (`$now+P1M`) and keeps the `@HH:MM` pin. The old form still works, with a warning, and will be removed in a future minor version. (#469)
