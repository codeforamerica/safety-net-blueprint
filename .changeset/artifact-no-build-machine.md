---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-cli": minor
---

The contracts artifact no longer records the machine that built it: each document carries `relativePath` and no absolute `path`, and `blueprint-bundle-contracts` no longer stamps a build timestamp. An artifact gets committed and inlined into a page, so an absolute path published the build directory, and a timestamp meant every rebuild produced a diff with no contract change behind it. The same contract set now serializes to the same bytes. `extract(artifact, 'docs')` still gives each document a `path` — its place in the set. (#448)
