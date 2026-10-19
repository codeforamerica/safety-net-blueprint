---
"@codeforamerica/blueprint-core": minor
---

Before, a value a ruleset needed but no caller should send, such as a conversion factor, had to be an input with a default, and every result resting on it came back as a placeholder. Now a ruleset declares it under `constants`, facts read it as `constants.<name>`, and the compiled graph carries its value. An input named `constants` alongside the block is refused. (#481)
