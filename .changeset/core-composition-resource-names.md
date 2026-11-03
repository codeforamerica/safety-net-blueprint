---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** Where a composition named its resource by path segment or storage name, such as `resource: application-members`, name it by its schema, `resource: ApplicationMember`, as `x-relationship` does. A name that matches no schema now fails validation. (#516)
