---
"@codeforamerica/blueprint-core": patch
---

Before, the AsyncAPI documents for each API's events, and the platform timer events, had no examples. Now each message carries one, a whole CloudEvent ready to publish; a generated one is built from the resource's first sample record. (#465)
