---
"@codeforamerica/blueprint-core": minor
"@codeforamerica/blueprint-mock-server": minor
---

**Breaking:** Where a config catalog was `queues: [...]`, write `queues: { resource: Queue, entries: [...] }`. Validation now fails when a seeded resource does not declare `source`, which the new shared `ConfigSource` in `base/schemas/enums.yaml` defines. (#470)
