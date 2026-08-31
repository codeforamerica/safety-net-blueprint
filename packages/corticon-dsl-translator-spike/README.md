# Corticon → decision-rules DSL translator spike

A state that's spent years encoding eligibility rules in a forward-chaining engine like Corticon doesn't have a good way to move to something better. Rewrite everything by hand in a new system, and you're migrating blind — there's no way to know the rewritten rules actually behave like the ones they replaced until something breaks in production. That risk alone is often enough to keep a state stuck on an aging system indefinitely.

This spike proves there's a third option: **translate** a real ruleset instead of rewriting it, and **verify** the translation by replaying the original system's own captured input/output traces through the translated rules and diffing the results against what the original system actually produced — so a migration is provably correct on real historical cases, not just hoped to be.

That same trace-and-diff approach can carry a state all the way through cutover, not just through this spike: generating synthetic partial-input cases to exercise the completeness model a forward-chaining engine's own traces can't produce, and running both engines side by side on live traffic before ever retiring the original, extend the same verification to full production confidence.

Feasibility spike for issue [#388](https://github.com/codeforamerica/safety-net-blueprint/issues/388), de-risking Decisions 9 and 10 of [`decision-rules-dsl.md`](../../docs/architecture/cross-cutting/decision-rules-dsl.md) (design issue [#386](https://github.com/codeforamerica/safety-net-blueprint/issues/386)).

## A broader design insight (working title: goal-first logic design)

This spike started as a migration tool — derive a dependency graph from existing Corticon rules, then translate each node. But the methodology that emerged generalizes beyond migration.

The key insight: **a dependency graph is a valid primary design artifact for decision logic**, not just a derived representation of rules. The design process looks like this:

1. Define the goal outputs — what does this program need to produce? (e.g. `meetsWorkRequirement`, `adjustedHours`)
2. For each output, ask: what does it depend on? Express it as a function of those dependencies.
3. Repeat backward until you reach pure inputs (things the caller supplies).
4. The resulting graph *is* the logic — implementation in any target system (rules engine, DSL, code) follows from it.

This works equally well for migration (the graph is derived from existing rules, then translated) and greenfield design (the graph is designed directly, then implemented). The Corticon spike proves the migration path is feasible. The greenfield path is just the same shape in reverse.

What makes this feel distinct from "rules to graph" or "fact graph" framing: the graph isn't a representation of rules — it's a representation of *what you want to know and what you need in order to know it*. The rules are one way to implement that; they're not the thing itself.

This probably belongs in `docs/architecture/` eventually, but capturing it here first.

## Background reading

- [`docs/FORWARD-VS-REVERSE-CHAINING.md`](./docs/FORWARD-VS-REVERSE-CHAINING.md) — Corticon and the decision-rules DSL are two fundamentally different styles of rules engine; why translating between them is hard, not a syntax swap.
- [`docs/TRANSLATION-PATTERNS.md`](./docs/TRANSLATION-PATTERNS.md) — the specific real patterns this translator has to recognize (a genuine loop vs. an ordinary decision-table row vs. a null-check standing in for missing data) rather than translate literally.
- [`docs/CORTICON-GLOSSARY.md`](./docs/CORTICON-GLOSSARY.md) / [`docs/DEPENDENCY-GRAPH-GLOSSARY.md`](./docs/DEPENDENCY-GRAPH-GLOSSARY.md) — vocabulary for each side of the translation, for readers unfamiliar with either.
- [`docs/WHY-A-CUSTOM-DEPENDENCY-GRAPH-ENGINE.md`](./docs/WHY-A-CUSTOM-DEPENDENCY-GRAPH-ENGINE.md) — why the decision-rules DSL is a new engine inspired by IRS Direct File's open-source Fact Graph, not an adoption of it.

Not production code — see the Non-goals section of #388. That said, the ingestion, dependency-graph, and classification layers (`src/sources/corticon/`, `src/graph/`, `src/sources/corticon/classify/`) are specifically written to be reusable beyond this spike, not disposable: Decision 9 already frames a real Corticon→DSL translator as a documented adoption path a state migration would eventually need, and parsing Corticon's real file formats is the first thing that translator would have to do. `src/sources/corticon/ingest-project.js` takes a project directory as a command-line argument rather than hardcoding paths to the fixtures above, so it works against any real Corticon project, not just this spike's examples. What's spike-scoped is *breadth* of coverage (only the constructs our fixtures actually contain), not the parsing approach itself.

## Fixtures

Real Corticon project files, vendored locally so this spike doesn't depend on live GitHub access:

| Directory | Source | Role |
|---|---|---|
| `fixtures/corticon/government/dc-medicaid-chip/` | `github.com/corticon/corticon.js-samples`, "Washington D.C. Medicaid and CHIP Eligibility Determination" | Primary example — drives the actual translator/translation build-and-validate work |
| `fixtures/corticon/vendor-samples/irr/` | `github.com/corticon/corticon-classic-samples`, "Internal Rate of Return" | Reference — genuine cycle, real `iterative="true"` shape |
| `fixtures/corticon/vendor-samples/mortgage/` | `github.com/corticon/corticon-classic-samples`, "Mortgage" | Reference — null-check masking (`Regular_NoData.ers`), filters (`Select_Credit.ers`) |
| `fixtures/corticon/vendor-samples/servicecallout/` | `github.com/corticon/corticon.js-samples`, `ServiceCallOut/RESTCall` | Reference — real `connectorList` service call-out shape |
| `fixtures/corticon/synthetic/branch-reconstruction/` | Original, hand-authored (see its own README) | Reference — real confirmed `BranchContainer` schema, reconstructed rather than vendored since the only real examples found have no license |
| `fixtures/corticon/synthetic/all-patterns/` | Original, hand-authored | Deliberate stress test for Phase 3 classification — every real pattern from the table above, coexisting in one project, to prove the classifier *distinguishes* them rather than just detects each in isolation. No real Corticon-computed output exists for it (nobody has run it through Corticon) — structural/classification evidence only, not golden-master |

## Layout

- `fixtures/` — real (and one original-reconstruction) Corticon project files, per above
- `src/sources/corticon/corticon/` — Phase 1: parses the four real Corticon file types (`.ecore`/`.ers`/`.erf`/`.ert`) into an in-memory model
- `src/sources/corticon/ingest-project.js` — runs Phase 1 against a real Corticon project directory. Named for what it does (parallel to `graph-project.js` below, and the other phase entry points — `translate-project.js`, `classify-project.js` — rather than one growing monolithic `cli.js`), not for whether it's "the pipeline" vs. "a debug tool": there's no separate non-CLI ingestion script, this is it. Produces `{slug}-corticon.json` (includes `sourceType: "corticon"` and `ruleId` on each rule).
- `src/graph/` — Phase 2: builds the universal attribute dependency graph from a Phase 1 project model (which attribute reads feed which attribute writes, across the whole project). Contains `build-graph.js` and `graph-project.js`.
- `src/graph/graph-project.js` — standalone debug tool for Phase 2. Takes a Phase 1 JSON file as input and prints a graph summary. `--out` writes `{slug}-graph.json` (`{ nodes, edges }` where edges carry `ruleId`). Not part of the main pipeline — `translate-project.js` produces `graph.json` as a side output instead.
- `src/sources/corticon/classify/` — Phase 3: resolves ruleflow-invocation context (is a rulesheet ever reached from inside a loop or a branch?) and classifies cycles/self-loops and other rule-level patterns using that context
- `src/sources/corticon/classify-project.js` — runs Phase 3. Takes the Phase 1 corticon.json as input. Produces `{slug}-patterns.json` (`{ sourceFile, classification }` with universal graph findings + source-detected patterns).
- `src/sources/corticon/translate-project.js` — Phase 4: translates classified patterns to blueprint-dsl facts. Produces `{slug}-blueprint-dsl.json` (`{ facts, translationLog }` with optional `meta` per fact) and `{slug}-graph.json` (`{ nodes, edges }` where edges carry `ruleId`) as a side output.
- `src/translation-patterns.yaml` — universal translation pattern catalog; applies to any rule source
- `src/translation-patterns.yaml` — universal translation pattern catalog; applies to any rule source
- `src/targets/blueprint-dsl/` — blueprint-dsl target: fact dependency graph and HTML visualizer
  - `visualize-graph.js` — renders a fact dependency graph SVG from `{slug}-blueprint-dsl.json`
  - `visualize-graph-html.js` — renders a full interactive HTML report (data model, sink candidates, subgraph drill-down) from `{slug}-blueprint-dsl.json` + `{slug}-patterns.json`
- `src/sources/corticon/visualize-rules.js` — renders an HTML rules diagram from `{slug}-patterns.json`, annotating each rulesheet and rule with its classification tags (null-default, entity-creation, unreachable, etc.)
- `src/cli-utils.js` — shared `--out`/`--help` arg parsing and Map/Set-to-JSON conversion, used by every `*-project.js` script so each doesn't reimplement the same thing
- `src/map-utils.js` — shared Map-or-plain-object helpers, used by both the graph and classification layers since either one may run against a freshly-loaded project or a JSON file read back in from a prior phase
- `src/tests/` — real, automated tests (`node --test`) asserting against the real fixtures above — the fixtures are test *input*, not the tests themselves. Includes `cli-pipeline.test.js`, which runs the actual CLI scripts as subprocesses end-to-end, not just the underlying functions.
- `generated/` — gitignored; only exists for the `*-project.js` scripts' `--out` dumps (named `generated/` for consistency with the repo's existing convention, e.g. top-level `packages/generated`)

### What ingestion actually produces, and where it goes

`loadProject(projectDir)` (`src/sources/corticon/corticon/project.js`) recursively discovers every `.ecore`/`.ers`/`.erf`/`.ert` file under a given directory — any real Corticon project, not just the fixtures above — and returns a single in-memory model: `{ projectDir, vocabularies, rulesheets, ruleflows, ruletests }`, each a `Map` keyed by relative file path. Each rulesheet also includes `filters` — real filter definitions confirmed in `Select_Credit.ers` (e.g. `liability.accountType = 'CreditLine'`), extracted the same way as conditions/actions. This was a real gap in the initial Phase 1 build (not checked against every pattern in #388's table at the time), added afterward once caught.

`src/sources/corticon/ingest-project.js` ingests a project directory using that function and prints a summary to stdout; adding `--out <file>` additionally writes the full model as JSON into `generated/` (gitignored) if you want to look at it. The output includes `sourceType: "corticon"` and `ruleId` on each rule. Later phases call `loadProject()` directly and consume the model in-process — this script's file output is for debugging convenience, not a required hand-off between phases.

### What the dependency graph produces, and where it goes

`buildDependencyGraph(project)` (`src/graph/build-graph.js`) walks every rule in every rulesheet and records an edge from each attribute its condition/action *reads* to the attribute it *writes*, across the whole project. It returns `{ nodes, edges, writes }` — `writes` tracks every rulesheet that writes each attribute, which is what `findCrossRulesheetAssembly()` and entity-creation detection both need. `findCycles()` finds structural self-loops/cycles in the raw graph — but a raw cycle isn't automatically a genuine Decision 9 cycle needing manual redesign: confirmed real self-loops include an ordinary decision-table alternative row (DC Medicaid) and null-check masking (Mortgage) alongside IRR's genuine one, and telling them apart needs the rule's own condition plus the containing Ruleflow node's `iterative` flag (Phase 3's job — see `src/sources/corticon/classify/cycle-classifier.js`).

`src/graph/graph-project.js` is a standalone debug tool that builds the graph from a Phase 1 JSON file and prints a summary (node/edge counts, cycle candidates, cross-rulesheet assembly); `--out <file>` writes `{slug}-graph.json` as `{ nodes, edges }` where edges carry `ruleId`. In the main pipeline, `graph.json` is produced as a side output of `translate-project.js` rather than a standalone phase: Phase 3 (`classify-project.js`) takes the Phase 1 corticon.json directly, since classification needs the original rule/ruleflow detail (condition text, `iterative` flags, `BranchContainer`/`connectorList` shape) that a pure topology graph doesn't retain.

```
node src/sources/corticon/ingest-project.js fixtures/corticon/government/dc-medicaid-chip
node src/sources/corticon/ingest-project.js fixtures/corticon/government/dc-medicaid-chip --out generated/dc-medicaid-chip-corticon.json

node src/sources/corticon/classify-project.js generated/dc-medicaid-chip-corticon.json
node src/sources/corticon/classify-project.js generated/dc-medicaid-chip-corticon.json --out generated/dc-medicaid-chip-patterns.json

node src/sources/corticon/translate-project.js generated/dc-medicaid-chip-patterns.json
node src/sources/corticon/translate-project.js generated/dc-medicaid-chip-patterns.json --out generated/dc-medicaid-chip-blueprint-dsl.json

npm test
```
