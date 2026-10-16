---
"@codeforamerica/blueprint-rules-engine": minor
---

Before, the engine had no notion of a value fixed by the ruleset. Now it reads a graph's `constants` into scope as `constants`, a caller can't replace them, and a result resting on one is complete. The FactGraph translator writes each as a Derived literal so the two evaluators agree. (#481)
