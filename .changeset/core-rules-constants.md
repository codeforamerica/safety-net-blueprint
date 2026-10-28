---
"@codeforamerica/blueprint-core": minor
---

Before, a value a ruleset needed but no caller should send, such as a conversion factor, had to be an input with a default, and every result resting on it came back as a placeholder. Now a ruleset declares it under `constants`, facts read it as `constants.<name>`, and the compiled graph carries its value. A constant can be a date (`type: string`, `format: date`), such as the day a requirement takes effect, and compares with a date input; one whose value isn't a date is refused. An input named `constants` alongside the block is refused. (#481)
