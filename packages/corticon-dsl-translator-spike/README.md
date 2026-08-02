# Corticon → decision-rules DSL translator spike

Feasibility spike for issue [#388](https://github.com/codeforamerica/safety-net-blueprint/issues/388), de-risking Decisions 9 and 10 of
[`decision-rules-dsl.md`](../../docs/architecture/cross-cutting/decision-rules-dsl.md) (design issue [#386](https://github.com/codeforamerica/safety-net-blueprint/issues/386)).

Not production code — see the Non-goals section of #388. That said, the ingestion layer (`src/ingest/`) specifically is written to be reusable beyond this spike, not disposable: Decision 9 already frames a real Corticon→DSL translator as a documented adoption path a state migration would eventually need, and parsing Corticon's real file formats is the first thing that translator would have to do. It takes a project directory as a command-line argument rather than hardcoding paths to the fixtures above, so it works against any real Corticon project, not just this spike's examples. What's spike-scoped is *breadth* of coverage (only the constructs our fixtures actually contain), not the parsing approach itself.

## Fixtures

Real Corticon project files, vendored locally so this spike doesn't depend on live GitHub access:

| Directory | Source | Role |
|---|---|---|
| `fixtures/dc-medicaid-chip/` | `github.com/corticon/corticon.js-samples`, "Washington D.C. Medicaid and CHIP Eligibility Determination" | Primary example — drives the actual translator/crosswalk build-and-validate work |
| `fixtures/irr/` | `github.com/corticon/corticon-classic-samples`, "Internal Rate of Return" | Reference — genuine cycle, real `iterative="true"` shape |
| `fixtures/mortgage/` | `github.com/corticon/corticon-classic-samples`, "Mortgage" | Reference — null-check masking (`Regular_NoData.ers`), filters (`Select_Credit.ers`) |
| `fixtures/servicecallout/` | `github.com/corticon/corticon.js-samples`, `ServiceCallOut/RESTCall` | Reference — real `connectorList` service call-out shape |
| `fixtures/branch-reconstruction/` | Original, hand-authored (see its own README) | Reference — real confirmed `BranchContainer` schema, reconstructed rather than vendored since the only real examples found have no license |

## Layout

- `fixtures/` — real (and one original-reconstruction) Corticon project files, per above
- `src/ingest/` — Phase 1: parses the four real Corticon file types (`.ecore`/`.ers`/`.erf`/`.ert`) into an in-memory model
- `src/ingest-project.js` — runs Phase 1 against a real Corticon project directory. Named for what it does (parallel to `graph-project.js` below, and likely later entry points — `translate-project.js`, `classify-project.js` — rather than one growing monolithic `cli.js`), not for whether it's "the pipeline" vs. "a debug tool": there's no separate non-CLI ingestion script, this is it.
- `src/graph/` — Phase 2: builds the attribute dependency graph from a Phase 1 project model (which attribute reads feed which attribute writes, across the whole project)
- `src/graph-project.js` — runs Phase 2. Takes a Phase 1 JSON file (from `ingest-project.js --out`) as input, same chaining pattern as the phases themselves.
- `src/cli-utils.js` — shared `--out`/`--help` arg parsing and Map/Set-to-JSON conversion, used by every `*-project.js` script so each doesn't reimplement the same thing
- `src/tests/` — real, automated tests (`node --test`) asserting against the real fixtures above — the fixtures are test *input*, not the tests themselves
- `generated/` — gitignored; only exists for the `*-project.js` scripts' `--out` dumps (named `generated/` for consistency with the repo's existing convention, e.g. top-level `packages/generated`)
- `src/` (later phases) — classification, translation, crosswalk generation

### What ingestion actually produces, and where it goes

`loadProject(projectDir)` (`src/ingest/project.js`) recursively discovers every `.ecore`/`.ers`/`.erf`/`.ert` file under a given directory — any real Corticon project, not just the fixtures above — and returns a single in-memory model: `{ projectDir, vocabularies, rulesheets, ruleflows, ruletests }`, each a `Map` keyed by relative file path. Each rulesheet also includes `filters` — real filter definitions confirmed in `Select_Credit.ers` (e.g. `liability.accountType = 'CreditLine'`), extracted the same way as conditions/actions. This was a real gap in the initial Phase 1 build (not checked against every pattern in #388's table at the time), added afterward once caught.

`src/ingest-project.js` ingests a project directory using that function and prints a summary to stdout; adding `--out <file>` additionally writes the full model as JSON into `generated/` (gitignored) if you want to look at it. Later phases will call `loadProject()` directly and consume the model in-process — this script's file output is for debugging convenience, not a required hand-off between phases.

### What the dependency graph produces, and where it goes

`buildDependencyGraph(project)` (`src/graph/build-graph.js`) walks every rule in every rulesheet and records an edge from each attribute its condition/action *reads* to the attribute it *writes*, across the whole project. It returns `{ nodes, edges, writes }` — `writes` tracks every rulesheet that writes each attribute, which is what `findCrossRulesheetAssembly()` and entity-creation detection both need. `findCycles()` finds structural self-loops/cycles in the raw graph — but a raw cycle isn't automatically a genuine Decision 9 cycle needing manual redesign: confirmed real self-loops include an ordinary decision-table alternative row (DC Medicaid) and null-check masking (Mortgage) alongside IRR's genuine one, and telling them apart needs the rule's own condition plus the containing Ruleflow node's `iterative` flag (Phase 3's job).

`src/graph-project.js` builds the graph from a Phase 1 JSON file and prints a summary (node/edge counts, cycle candidates, cross-rulesheet assembly); `--out <file>` writes the full graph as JSON.

```
node src/ingest-project.js fixtures/dc-medicaid-chip
node src/ingest-project.js fixtures/dc-medicaid-chip --out generated/dc-medicaid-chip.json

node src/graph-project.js generated/dc-medicaid-chip.json
node src/graph-project.js generated/dc-medicaid-chip.json --out generated/dc-medicaid-chip.graph.json

npm test
```
