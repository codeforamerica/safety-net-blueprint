---
"@codeforamerica/blueprint-core": minor
---

Before, when two APIs declared the same operationId, a state machine call or an Arazzo step naming it was checked against whichever was read first. Now `extract(docs, 'operations')` finds an operation by a bare id or by `$apis.<api>.<id>`; validation reports a bare id more than one API declares, naming the qualified forms, and an id repeated within one document; and an Arazzo step qualified by its source is checked against that source's document. (#520)
