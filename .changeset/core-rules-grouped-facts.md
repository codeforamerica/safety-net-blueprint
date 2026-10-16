---
"@codeforamerica/blueprint-core": minor
---

Before, a fact whose path had a dot passed the rules schema but failed graph and annotation validation. Now a dot groups facts, as `risks.earnedIncomeVaries`, and the fact keeps its whole path in expressions, in the answer and in annotation keys. (#481)
