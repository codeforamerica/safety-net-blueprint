---
"@codeforamerica/blueprint-cli": patch
---

Before, the rules client generated for a ruleset with a grouped or per-item output, such as `risks.cashIncome` or `reviewMonths[].qualifies`, wasn't valid TypeScript. Now those names are quoted, and a per-item output is typed as one value per item. (#496)
