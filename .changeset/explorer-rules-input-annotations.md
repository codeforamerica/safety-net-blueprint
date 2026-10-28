---
"@codeforamerica/blueprint-explorer": minor
---

Before, a rules page read only `{domain}-annotations.yaml`, so annotations in a domain's other annotation files (`{domain}-annotations-{name}.yaml`) didn't appear, and the annotations explorer listed a constant's annotations without linking to them. Now a rules page reads every annotation file, merging entries for the same key; clicking an input lists each of its paths with that path's annotations; and the annotations explorer links constant and input annotations to their rules page.
