---
"@codeforamerica/blueprint-rules-engine": minor
---

Before, a fact reading a field one list item didn't have, such as a household member with no `dateOfBirth`, came back as an error. Now it's `missing`, naming the item at its position (`$.household.members[1].dateOfBirth`), or a `placeholder` when the schema gives the field a default, unless another item or the rest of the expression already settles the answer. (#488, #496)
