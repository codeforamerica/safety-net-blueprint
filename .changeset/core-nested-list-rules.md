---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** Before, validation held only lists at a path with no parameters to the list rules, so a nested list like `/applications/{applicationId}/members` could leave out `q`, `limit` or `offset`. Now any GET that returns a list is held to them; add `SearchQueryParam` where validation reports it missing.
