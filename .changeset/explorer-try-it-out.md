---
"@codeforamerica/blueprint-explorer": minor
---

Before, running a contract set's scenarios in a browser meant building the harness's demo page, which isn't published. Now the explorer builds a Try it out page that runs the mock server in the browser, plays the scenarios a step at a time and sends any operation a request, served or opened from disk; `first_tour` in `config.yaml` picks the scenario it opens with. (#465)
