---
"@codeforamerica/blueprint-rules-engine": minor
---

Before, a fact reading a field one list item didn't have, such as a household member with no `dateOfBirth`, came back as an error. Now it's `missing`, naming the item path, unless another item or the rest of the expression already settles the answer. (#488)
