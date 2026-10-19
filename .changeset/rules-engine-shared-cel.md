---
"@codeforamerica/blueprint-rules-engine": patch
---

Before, the rules engine evaluated CEL with a setup of its own, separate from the one used for state machine and composition expressions. Now it uses `@codeforamerica/blueprint-core/cel`, which it depends on, so a ruleset and a guard are evaluated the same way. (#445)
