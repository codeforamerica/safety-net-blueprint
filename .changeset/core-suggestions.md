---
"@codeforamerica/blueprint-core": minor
---

A contract set can now include suggestions by listing the `suggestions` capability in `x-capabilities`: `/decision-support/suggestions` records something proposed to a person — a call to an operation the contracts declare, or something pointed out about a record in a category the set declares in a `suggestion-categories` registry. The call's shape, `OperationCall`, is in `base/schemas/operations.yaml` for any contract to use. (#469)
