---
"@codeforamerica/blueprint-explorer": patch
---

Before, the API reference linked fields to the data dictionary by schema name, so most links led nowhere — 599 of 622 on the intake page. Now it reads the domain's field inventory, links each field to the entry the dictionary actually has, and leaves a field it doesn't have unlinked. A page finds its dictionary by its document's domain, so platform-events links into the platform dictionary. (#481)
