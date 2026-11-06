---
"@codeforamerica/blueprint-core": minor
---

A contract set can now include suggestions by listing `suggestions` in `x-capabilities`: `/decision-support/suggestions` records a call to an operation, such as a JSON Patch to an editable composition that adds a member and their income together, or a note about a record, proposed to a person, who accepts it, dismisses it with a reason, or lets it expire. Accepting a proposed call makes it, as the person accepting or as they corrected it, and a proposal repeating one still open or dismissed is refused with `409`. (#469, #517)
