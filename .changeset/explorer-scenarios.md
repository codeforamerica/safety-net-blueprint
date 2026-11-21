---
"@codeforamerica/blueprint-explorer": minor
---

Before, running a contract set's scenarios in a browser meant building the harness's demo page, which isn't published. Now, for a contract set with scenarios, the explorer builds a Scenarios page that runs the mock server in the browser and plays each scenario a step at a time, served or opened from disk; `first_tour` in `config.yaml` picks the scenario it opens with. (#465)
