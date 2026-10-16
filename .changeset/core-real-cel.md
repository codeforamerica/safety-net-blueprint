---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** before, validation's "CEL syntax" check asked whether a rules expression parsed as JavaScript, so `$this.name` or `a?.b` passed. Now it parses expressions as CEL, and `@codeforamerica/blueprint-core/cel` exports the evaluator the mock server uses. (#445)
