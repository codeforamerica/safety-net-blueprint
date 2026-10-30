---
"@codeforamerica/blueprint-mock-server": patch
---

Before, a procedure called from inside a `forEach` had its `with:` arguments read after the loop, so `with: { id: $id }` didn't see the item. Now they're read where the call stands, giving each call its own item.
