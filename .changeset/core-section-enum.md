---
"@codeforamerica/blueprint-core": patch
---

Before, the `section` path parameter on a sectionView composition's state endpoints was any string. Now it takes its values from the composition's section enum, such as `ApplicationReviewSections`, so API docs list them and the generated client types them.
