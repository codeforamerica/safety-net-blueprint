---
"@codeforamerica/blueprint-core": minor
---

**Breaking:** Where a state machine emitted `scheduling.timer.requested` or `scheduling.timer.cancelled`, emit `platform.timer.requested` or `platform.timer.cancelled`, which every contract set now gets from the framework. Their payload schemas are renamed `TimerRequestedEvent` and `TimerCancelledEvent`. (#469)
