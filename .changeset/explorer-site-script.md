---
"@codeforamerica/blueprint-explorer": minor
---

Before, every call from a built explorer went to the mock in the page. Now `script` in `config.yaml` names a JavaScript file every page loads before the mock starts, and the routing it sets on `BlueprintExplorer.routing`, in the mock server's routing format, sends chosen APIs to real services, such as through a handler that adds the visitor's sign-in token. An operation whose call leaves the page is tagged "Real service" beside Send. (#543)
