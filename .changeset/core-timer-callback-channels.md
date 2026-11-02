---
"@codeforamerica/blueprint-core": minor
---

Before, the event a timer service sends when a state machine's timer fires, such as `decision-support.suggestion_expiry`, had no channel in the generated AsyncAPI. Now each timer a machine declares gets one, carrying `TimerCallbackEvent`, and the timer schemas say the callback keeps the request's `subject` and sets `causationid` to the request's id. (#469)
