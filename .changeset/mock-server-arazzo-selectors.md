---
"@codeforamerica/blueprint-mock-server": minor
---

Before, a scenario could take a value from a response only at a fixed place, such as `$response.body#/items/0/id`. Now the runner reads Arazzo 1.1 selectors, so a step can pick items out of a list by what they hold, as in `$.items[?@.status == 'proposed'].id`, and check a response with a JSONPath condition. (#469)
