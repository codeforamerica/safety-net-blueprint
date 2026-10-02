---
"@codeforamerica/blueprint-mock-server": patch
---

`createMockServer({ basePath })` strips a path prefix before matching, for a page served from a subdirectory — GitHub Pages puts a project site at `/<repo>/`, so a request for `/intake/applications` arrives as `/<repo>/mock/intake/applications`. The prefix is removed once, at the edge, so handlers and HTTP stubs never see it. (#448)
