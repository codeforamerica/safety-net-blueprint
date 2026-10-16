---
"@codeforamerica/blueprint-core": patch
---

Before, a ruleset input that `$ref`d a schema in another file stopped at that file's own refs, so fields under them, such as a list item's date of birth, were never declared. Now refs are followed from the file they're written in. (#481)
