---
"@codeforamerica/blueprint-mock-server": minor
---

A create carrying an `OperationCall` — a suggestion's proposed change — is now refused with a 422 naming the field when the operation it names doesn't exist, or when its parameters or body don't match what that operation accepts. (#469)
