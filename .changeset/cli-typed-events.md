---
"@codeforamerica/blueprint-cli": minor
---

Before, an API's events reached a generated TypeScript client as a generic envelope. Now each API that sends events has `Events` beside its SDK functions: a type for each event with its exact `data`, `Events.is` to narrow an event by its type, and `Events.publish` to send one through `publishEvent` with its data checked against the event's schema. (#548)
