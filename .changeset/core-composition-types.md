---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** Where a composition declared `state`, make it `compositeType: sectionView`; where `endpoint.methods` listed anything but `get`, remove it, and use `compositeType: editable` for a composition clients change. (#516)
