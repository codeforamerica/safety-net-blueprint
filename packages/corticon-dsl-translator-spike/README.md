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
- `src/ingest-project.js` — runs Phase 1 against a real Corticon project directory. Named for what it does (parallel to likely later entry points — `translate-project.js`, `classify-project.js` — rather than one growing monolithic `cli.js`), not for whether it's "the pipeline" vs. "a debug tool": there's no separate non-CLI ingestion script, this is it.
- `src/tests/` — real, automated tests (`node --test`) asserting against the real fixtures above — the fixtures are test *input*, not the tests themselves
- `generated/` — gitignored; only exists for `ingest-project.js --out`'s output dumps (named `generated/` for consistency with the repo's existing convention, e.g. top-level `packages/generated`)
- `src/` (later phases) — read/write graph construction, classification, translation, crosswalk generation

### What ingestion actually produces, and where it goes

`loadProject(projectDir)` (`src/ingest/project.js`) recursively discovers every `.ecore`/`.ers`/`.erf`/`.ert` file under a given directory — any real Corticon project, not just the fixtures above — and returns a single in-memory model: `{ projectDir, vocabularies, rulesheets, ruleflows, ruletests }`, each a `Map` keyed by relative file path.

`src/ingest-project.js` ingests a project directory using that function and prints a summary to stdout; adding `--out <file>` additionally writes the full model as JSON into `generated/` (gitignored) if you want to look at it. Later phases will call `loadProject()` directly and consume the model in-process — this script's file output is for debugging convenience, not a required hand-off between phases.

```
node src/ingest-project.js fixtures/dc-medicaid-chip
node src/ingest-project.js fixtures/dc-medicaid-chip --out generated/dc-medicaid-chip.json
npm test
```
