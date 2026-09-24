# Rules Contracts

**Status:** Approved

See also: [Contract-Driven Architecture](contract-driven-architecture.md) | [Resolve Pipeline](resolve-pipeline.md) | [Contract Metadata](cross-cutting/contract-metadata.md) | [Building a New Domain](../getting-started/new-domain-builders.md)

---

Rules contracts are the feature that makes the Blueprint complete.

The blueprint already has two contract types: OpenAPI specs describe data — what resources exist, what operations are available, what fields they carry. State machine contracts describe lifecycle — what states an object moves through and what triggers drive those transitions. State machines support some business logic — guards can check whether a field is present, whether a status flag is set, whether a condition holds before a transition fires — but they aren't designed to express the complex reasoning that drives benefits decisions. Income calculations, categorical eligibility criteria, work requirement checks, and multi-fact household evaluations don't belong in a guard condition. Before rules contracts, that logic had nowhere to live in the contract layer — it was buried in adapter code or locked inside vendor systems, invisible and hard to change.

Rules contracts are the business logic layer. A state can now express the entire logic of a benefits determination — not as code in an adapter, not as configuration only a vendor can modify, but as a readable, diffable, testable, overlayable YAML file that any engineer can audit and any state can customize.

On top of that, rules contracts have a particularly powerful property: **partial evaluation**. The evaluator doesn't require complete data — it runs against whatever is known, returns what it can resolve, and traces exactly which inputs are still missing for everything it can't. That's what enables progressive intake interviews, real-time eligibility screening, and adaptive data collection. But partial evaluation is a feature of the rules layer; the reason the rules layer exists is to give program logic a home in the contract.

The two contract types work together: a state machine `evaluate:` step can invoke a ruleset mid-transition, using the result to drive subsequent guards and actions. The same ruleset also runs in the browser during intake, in the mock server during development, and as a standalone endpoint for direct integration. One contract, every context.

---

## The Model: Partial Evaluation

A ruleset is a directed acyclic graph of named facts. Each fact is either an **input** (a value the caller supplies) or a **derived fact** (computed from other facts via a CEL expression). The evaluator walks the graph in topological order and resolves each fact from its dependencies.

The key property is **partial evaluation**: the evaluator runs against incomplete data. This isn't a limitation — it's the design. Most real-world intake and determination flows involve incomplete information. An applicant doesn't arrive with all their documents. A caseworker doesn't have all the verification results. A recertification interview surfaces new circumstances mid-call. Partial evaluation is what makes rules useful in these situations.

Each fact resolves to one of four states: **complete** (a value is available), **placeholder** (computed from a policy default rather than real data), **missing** (one or more inputs are absent), or **error** (the expression failed).

For missing facts, the evaluator doesn't just say "something is missing." It traces back through the dependency graph and returns the **specific input paths needed to resolve each pending output**. This is what enables progressive data collection: a UI calls the evaluator with whatever is known so far, and the response tells it exactly which facts to collect next to unlock the pending determinations — not "please fill out the whole form" but "to determine eligibility, we still need household income and housing expenses."

That only works if "we haven't asked yet" is distinguishable from "we asked, and there is nothing." So the contract treats the two differently:

| input | meaning | result |
|---|---|---|
| absent | not yet asked | `missing`, naming the path |
| `null` | asked; none | resolves — an empty collection, `placeholder` |
| `[]` | asked; none | resolves — `complete` |

The distinction is deliberate, and it is the one an engine is most likely to collapse. Reading an uncollected list as empty makes `exists(m, m.age >= 18)` answer `false` for a household whose members were never asked about — a confident wrong answer, and one that leaves a progressive interview with nothing to ask for. Absent is a question; null is an answer.

An engine that does not draw this distinction will produce different determinations from the same inputs, so it is part of the evaluation contract rather than an implementation detail. The executable form lives in `packages/blueprint-rules-engine/tests/conformance/cases.json` — a graph, inputs, and the nodes any engine must produce — which is what a replacement engine checks itself against (see [Decision 4](#decision-4-reference-implementation-not-a-mandated-engine)).

Few rules models support this. DMN returns a result or fails. Traditional rules engines require full input before evaluation. FactGraph (IRS) is the only widely known prior art — it is also a dependency graph model built around incompleteness — but it is heavyweight, authored in XML and implemented in Scala. The blueprint's evaluator takes the same model in a lighter form that runs on the server and in the browser.

---

## What This Enables

**Eligibility screening** — Run a ruleset against partial applicant data at the start of intake to identify which programs the household might qualify for, which eligibility probes to surface in the interview, and which verifications to request upfront.

**Progressive intake forms** — Instead of a fixed form, the UI asks only for the inputs needed to resolve the next batch of pending facts. Simple households get short flows. Complex ones get targeted follow-up. The rules drive the interview, not a static form definition.

**Recertification interview tools** — Before an interview, run the evaluator against the household's current record to identify which facts have changed or are inconsistent with what's on file. Surface only the probes that are actually triggered. A caseworker walks into a focused interview, not a generic checklist.

**Advisory evaluation during data entry** — Run the evaluator browser-side during intake without any server round-trip. As an applicant fills in fields, the UI can immediately show which determinations are already resolved, which are still pending, and what's needed to complete them.

**Any progressive narrowing problem** — The model isn't eligibility-specific. Any domain where the answer to "what do we need to know next?" depends on what's already known is a candidate: screening questionnaires, triage flows, document collection checklists, automated pre-qualification, risk scoring.

---

## Contract Artifacts

Rules contracts produce two artifacts:

**`*-rules.yaml`** — The authored contract. Declares rulesets with inputs, outputs, and facts as CEL expressions. Inputs and outputs can reference shared schemas, giving OpenAPI specs and rules files a common type baseline. Unlike the graph file, the rules file depends on blueprint tooling — `$ref` resolution, overlay conventions, schema validation — and does not include the resolved dependency graph nodes and edges. It is not universally portable.

**`*-graph.yaml`** — The compiled artifact produced by the resolve pipeline. Contains the fully resolved dependency graph — all nodes, edges, and expressions — with no references to blueprint-specific types or tooling. This is what the evaluator runs against. Any rules engine that implements the graph schema can evaluate it, which is what makes the reference evaluator replaceable. States deploy the graph; they author the rules file.

A ruleset can optionally declare a standalone HTTP endpoint, which the resolver generates into the resolved OpenAPI spec — callable from any HTTP client, served by the mock server, no additional wiring required. Rules contracts are otherwise orthogonal to OpenAPI specs: an OpenAPI spec never references a rules file. Rules inputs and outputs reference the same shared schemas as OpenAPI specs, giving both a common type baseline without coupling the contract types to each other.

---

## Invocation Modes

Three invocation modes, one evaluation contract:

1. **State machine `evaluate:` step** — Evaluation embedded in a workflow. The step references a ruleset, maps context data to input paths, and binds the result for use in subsequent steps and guards.

2. **Standalone endpoint** — A ruleset that declares an endpoint block gets a generated POST endpoint in the resolved OpenAPI spec. Useful for direct integration from a frontend or adapter, or for testing with curl.

3. **Browser client** — The `blueprint-rules-engine` package includes a browser-compatible evaluator that runs the same compiled graph client-side with no server required. The same API works identically on the server and in the browser.

---

## Package Split

**`blueprint-core`** owns the rules schema, validation, and resolve pipeline integration — the same package that owns OpenAPI validation and state machine contracts.

**`blueprint-rules-engine`** is the evaluator: a pure ESM package with no Node.js or DOM dependencies, browser-compatible by design. It's a **reference implementation** — the blueprint does not mandate a production evaluation engine. States can replace it with Corticon, IBM Cúram, Drools, or any other engine. The graph schema and evaluation contract are the stable interfaces; the evaluator is one implementation of them.

---

## Validation

The validator checks rules contracts for schema correctness, `$ref` resolution, cycle detection, unreachable node detection, CEL expression syntax, and cross-artifact field consistency — `$.path` references in expressions must match field names on the referenced input schemas.

---

## Conformance

Validation checks that a contract is well formed. Conformance checks that an *engine* behaves correctly — that the same graph and inputs produce the same determinations whichever engine runs them. [Decision 4](#decision-4-reference-implementation-not-a-mandated-engine) says the reference implementation is replaceable, and that only means something if a replacement has something concrete to satisfy.

| | |
|---|---|
| Corpus | `packages/blueprint-rules-engine/tests/conformance/cases.json` — graphs, inputs, and the nodes any engine must produce. Names no engine. |
| Report | `packages/blueprint-rules-engine/CONFORMANCE.md` — results of running engines against the corpus, regenerated by `tools/conformance-report.js` |

The corpus is data rather than code, because a second engine will not be written in JavaScript and cannot run this repository's tests. It states the behaviours that are contract rather than implementation: the four states, placeholder propagation, what makes an input missing rather than empty, and how a bad input is reported.

**This design is a work in progress.** The corpus sits inside the reference implementation's tests, not alongside the other contract artifacts, and has no schema, naming convention, or validation of its own. Whether conformance becomes a first-class contract artifact — and whether it generalizes beyond rules to state machines and compositions, which have the same substitutability problem — is open. Treat the location and format as provisional; the behaviours pinned there are not.

---

## Annotations and Policy Traceability

Rules contracts support annotations via the same format used across all contract types. Annotation files attach metadata to computed facts — regulatory citations, policy context, guidance text, or any other information a consumer needs to understand or display the fact. The Explorer renders annotations inline with the dependency graph, making the ruleset navigable and reviewable by non-engineers.

---

## Explorer Integration

The Explorer generates per-ruleset documentation pages from the compiled graph and annotation files. Each page includes an interactive dependency graph (click any node to trace its full upstream and downstream subgraph), a detail panel showing each fact's expression and policy annotations, and a live evaluation panel where example inputs can be navigated and modified. The browser-side evaluator runs directly in the page — no mock server required.

The Explorer makes rules reviewable by non-engineers. A policy analyst can load a ruleset, walk through a scenario, and verify that the probe logic matches the regulatory requirement — without a developer intermediary.

---

## Key design decisions

| # | Decision | Summary |
|---|---|---|
| 1 | [Expression language](#decision-1-expression-language) | CEL over DMN/FEEL, JSON Logic, and proprietary rule languages |
| 2 | [Partial evaluation as the core model](#decision-2-partial-evaluation-as-the-core-model) | Evaluator runs against incomplete data and traces missing inputs — not a failure mode, a design goal |
| 3 | [Two-artifact split: authored vs. compiled](#decision-3-two-artifact-split-authored-vs-compiled) | Authors work in `*-rules.yaml`; evaluator runs against compiled `*-graph.yaml` |
| 4 | [Reference implementation, not a mandated engine](#decision-4-reference-implementation-not-a-mandated-engine) | Blueprint provides `blueprint-rules-engine` as a reference; states can replace it |
| 5 | [Three invocation modes, one evaluation contract](#decision-5-three-invocation-modes-one-evaluation-contract) | State machine step, standalone endpoint, and browser client all use the same contract |
| 6 | [New evaluator rather than adopting FactGraph directly](#decision-6-new-evaluator-rather-than-adopting-factgraph-directly) | Blueprint builds on FactGraph's model but uses CEL and YAML rather than FactGraph's XML format |

---

### Decision 1: Expression language

**Status:** Decided: B

**What's being decided:** Which expression language facts use to compute derived values — the choice shapes authoring ergonomics, evaluation portability, and the range of operations (collection filtering, arithmetic, comparison) that rules can express.

**Considerations:**
- Safety net eligibility rules make heavy use of collection operations — filtering household members by age, employment status, citizenship — that require a language with first-class list comprehensions.
- The evaluator must run on both the server and in the browser without a compilation step. Languages with only JVM or heavyweight runtimes are not viable.
- DMN/FEEL has strong tooling (Camunda, Trisotech) and is an OMG standard, but FEEL implementations vary significantly and none are lightweight enough for browser execution. States that author in DMN can convert to CEL; the conversion script is the integration point.
- JSON Logic is browser-friendly but lacks list comprehensions and would require significant extensions for collection-based eligibility rules.
- CEL (Common Expression Language) is an open standard with lightweight, browser-compatible implementations, is used by Google (Firebase, IAM) and the CNCF ecosystem, and natively supports the collection operations eligibility rules require.

**Options:**
- **(A)** DMN/FEEL
- **(B)** ✓ CEL
- **(C)** JSON Logic
- **(D)** Proprietary/custom expression language

**Known gap:** States that currently author rules in DMN or a vendor-specific format must produce a conversion script to CEL. The blueprint does not provide a conversion tool — the tool is the state's integration point.

---

### Decision 2: Partial evaluation as the core model

**Status:** Decided: B

**What's being decided:** Whether the evaluator is designed around complete-input evaluation (run only when all inputs are available, return a result or error) or partial-input evaluation (run against whatever is known, report what is resolved and what is still needed).

**Considerations:**
- Benefits determination is never a single moment of complete information. Applications arrive incomplete. Verifications are pending. Recertification interviews surface new circumstances mid-call. A complete-input model forces all callers to assemble full input before evaluating — encoding the assembly logic in adapters or frontend code, outside the contract.
- None of the mainstream open-source rules engines support partial evaluation. Drools defers evaluation until all required facts are present and will not run with missing inputs. json-rules-engine treats missing facts as falsey — rules that touch them silently fail, with no tracing of what's missing. GoRules rejects the call outright if required inputs are absent. NRules (Rete-based) fires rules only when all conditions are matched. FactGraph (IRS) is the only open-source prior art that supports missing-input tracing — it is also a dependency graph model built around incompleteness — but it is heavyweight, authored in XML and implemented in Scala. See [Decision 6](#decision-6-new-evaluator-rather-than-adopting-factgraph-directly).
- Partial evaluation with missing-input tracing is what enables adaptive intake flows, progressive interview tools, and real-time eligibility screening without round-trips. These are among the highest-value use cases for benefits systems.

**Options:**
- **(A)** Complete-input evaluation — fail if any required input is absent
- **(B)** ✓ Partial evaluation — run against incomplete data, return resolved facts plus the specific input paths needed to resolve pending ones

---

### Decision 3: Two-artifact split: authored vs. compiled

**Status:** Decided: B

**What's being decided:** Whether the evaluator runs against the authored `*-rules.yaml` file directly, or against a separate compiled graph artifact produced by the resolve pipeline.

**Considerations:**
- Running against the authored file couples the evaluator to the rules authoring format, making it harder to evolve either independently. It also means every evaluator must implement overlay resolution, `$ref` expansion, and schema validation — work the resolve pipeline already does for other contract types.
- The `*-rules.yaml` file depends on blueprint-specific types and tooling, and does not include the resolved dependency graph nodes and edges — it is not universally portable. The `*-graph.yaml` contains the fully resolved graph with no blueprint dependencies: any rules engine that implements the graph schema can evaluate it. This is what makes the reference implementation replaceable (see [Decision 4](#decision-4-reference-implementation-not-a-mandated-engine)).
- A compiled graph artifact is analogous to what the resolve pipeline already produces for OpenAPI specs and state machines — a normalized, validated, deployment-ready form. States deploy the compiled artifact, not the source file.
- The compiled graph is what the Explorer visualizes and what the browser evaluator loads. Browsers should never receive raw rules files — only the compiled output.

**Options:**
- **(A)** Evaluator reads `*-rules.yaml` directly
- **(B)** ✓ Resolve pipeline compiles `*-rules.yaml` → `*-graph.yaml`; evaluator runs against the compiled graph

---

### Decision 4: Reference implementation, not a mandated engine

**Status:** Decided: B

**What's being decided:** Whether the blueprint mandates `blueprint-rules-engine` as the production evaluation engine, or provides it as a reference implementation that states can replace.

**Considerations:**
- Major platforms (Salesforce Government Cloud, IBM Cúram, ServiceNow) integrate with enterprise rules engines (Corticon, Drools, ILOG) rather than shipping their own. The engine is typically the most vendor-specific part of a benefits system.
- Several states already have Corticon or IBM Cúram licenses. Mandating a different engine would block adoption.
- The dependency graph model and evaluation contract (flat nodes map output shape — each fact keyed by name with `state`, `value`, and optional `missing` or `message` fields — and `$.path` input format) are the stable interfaces. The evaluator is an implementation of those interfaces. A state that uses Corticon in production can still use the reference evaluator in the browser and in development.
- The reference implementation proves the model is sound and provides a working evaluator for development, testing, and browser-side use cases where a vendor engine isn't available.

**Options:**
- **(A)** Mandate `blueprint-rules-engine` as the production evaluator
- **(B)** ✓ `blueprint-rules-engine` is a reference implementation; states can replace with any engine that satisfies the evaluation contract

---

### Decision 5: Three invocation modes, one evaluation contract

**Status:** Decided: B

**What's being decided:** How rulesets are invoked — whether to standardize on a single invocation model (server-side only, or browser-only) or to support multiple modes with a shared evaluation contract.

**Considerations:**
- Different use cases require different invocation contexts. Browser-side progressive evaluation during data entry cannot wait for a server round-trip. Workflow-embedded evaluation during determination needs to run inside a state machine action. Direct API integration from adapters or partner systems needs a callable HTTP endpoint.
- A single evaluation contract (same input format, same output shape) across all three modes means rules can be tested anywhere, run anywhere, and produce consistent results everywhere. This is the same portability principle that drives the rest of the blueprint.
- All major cloud platforms (AWS Step Functions, Salesforce Flow, Azure Logic Apps) support rules evaluation both embedded in workflows and as callable endpoints. Browser-side evaluation is newer but increasingly common in modern benefits systems.

**Options:**
- **(A)** Server-side only (state machine step + standalone endpoint)
- **(B)** ✓ Three modes — state machine `evaluate:` step, standalone endpoint, browser client — sharing one evaluation contract

---

### Decision 6: New evaluator rather than adopting FactGraph directly

**Status:** Decided: B

**What's being decided:** Whether to adopt IRS Direct File's FactGraph system as the blueprint's rules engine, or to build a new evaluator that takes the same partial-evaluation model but uses a different authoring format and implementation language.

**Considerations:**
- FactGraph is a well-designed system with genuine partial-evaluation support, and it is the direct inspiration for the blueprint's dependency graph model. States already familiar with IRS Direct File will recognize the concepts.
- FactGraph's rule authoring format is custom XML. The same logic that reads as `household.members.exists(m, m.age >= 18 && !m.isExempt)` in CEL becomes deeply nested XML: `<GreaterThan><Left><CollectionSize><Filter path="...">...</Filter></CollectionSize></Left><Right><Int>0</Int></Right></GreaterThan>`. This format is difficult to read and audit without specialized tooling, and not something most engineers — or policy analysts — would author directly.
- CEL (Common Expression Language) is an open standard maintained by Google and the CNCF, used in Firebase, Google Cloud IAM, and Kubernetes. It is concise and widely understood — the same logic that takes many lines of nested XML in FactGraph is a single readable expression in CEL.
- FactGraph is implemented in Scala, which is a capable language but not widely adopted outside of organizations already invested in it. States extending or replacing the evaluator would need Scala expertise; the blueprint's evaluator is plain JavaScript.
- The blueprint provides a FactGraph compatibility bridge (`toGraphWithFactGraph`, `toFactGraphXml`) for states that want to run parity tests against the FactGraph engine or interoperate with IRS Direct File systems.

**Options:**
- **(A)** Adopt FactGraph directly — use its XML format for rule authoring and its Scala engine for evaluation
- **(B)** ✓ Build on FactGraph's model — use the same dependency graph and partial-evaluation approach, with CEL expressions in YAML and a lightweight JavaScript evaluator; provide a FactGraph compatibility bridge for interoperability

---

### Decision 7: CEL library for blueprint-rules-engine

**Status:** Decided — implemented

**What's being decided:** Which JavaScript library evaluates CEL expressions in `blueprint-rules-engine`. The current `src/cel.js` is the mock server's regex-based transpiler copied verbatim — it rewrites a small subset of CEL to JavaScript strings and evaluates them via `new Function()`. It is not a deliberate library choice; it is a placeholder carried over from the spike and must be replaced with a spec-compliant implementation before the package is stable.

**Constraints:**
- The evaluator must run in the browser (`dist/browser.js`) without a build-time native module or WASM compilation step. Libraries with native `.node` bindings are not viable.
- The reference implementation should remain lightweight — no unnecessary runtime dependencies.
- The library must support the CEL operations eligibility rules require: `has()`, `.size()`, `.contains()`, `.filter()`, `.map()`, `.all()`, `.exists()`, list membership (`in`), arithmetic, and comparison operators.

**Considerations:**
- The current custom transpiler supports only ~8 CEL constructs, is not spec-compliant, uses `new Function()` (an eval equivalent, a security concern in a rules context), and will hit hard limits as rule complexity grows. It is not a viable long-term foundation for a production rules engine. Any expression using string methods (`startsWith`, `matches`), timestamp arithmetic, nested macros, or `has()` on deeply nested paths will silently return `undefined` — no parse error, no diagnostic, just a missing result.
- `cel-js` (ChromeGG, ~72K weekly npm downloads) was the most widely used JavaScript CEL library and is referenced in CEL's own documentation as a JavaScript implementation. It was archived by its maintainer on June 2, 2026. It should not be adopted for new projects.
- `@cel-community/cel-js` does not exist — the npm package and GitHub org are not real. `cel-javascript` (robbertvanelk) exists but has ~5 weekly downloads, was last published January 2024, and is explicitly marked "not production ready."
- Google does not publish a JavaScript CEL library. All official Google CEL work is in `cel-go` (Go) and a C++ toolchain.
- `@bufbuild/cel` (~527K weekly downloads) is maintained by Buf Technologies, whose track record of spec-compliant protocol implementations (cf. protobuf-es) is strong. It ships `@bufbuild/cel-spec`, which includes the official Google CEL conformance test corpus — expressions can be validated against the same suite used for `cel-go`. Its `@bufbuild/re2` dependency is a pure JavaScript port of the RE2 regex engine (no native bindings, no WASM), making it fully browser-compatible. Static type checking is not yet implemented (open issue), but the library covers all operations eligibility rules require. Licensed Apache 2.0.
- `@marcbachmann/cel-js` (~289K weekly downloads) is a zero-dependency, ESM-only implementation with a `check()` API for static type validation at authoring time — the closest a JS library currently comes to formal verification support. Browser-compatible. Does not use RE2, so regex behavior may diverge from CEL spec in edge cases (unlikely to matter for eligibility rule expressions, which do not use regex). No published conformance test results.
- Formal verification of CEL expressions — proving that two rules cannot produce contradictory outcomes, or that a guard fires before the check that depends on it — has no npm equivalent. Google's `cel-java` verifier (backed by the Z3 SMT solver, announced August 2026) is the only available tool for this, and it is Java-only. For a future formal verification layer, the recommended pattern is: (1) parse and store ASTs at rule authoring time, (2) run the `cel-java` verifier against rule files as a CI step, failing the pipeline if declared invariants are violated. CEL's non-Turing completeness — expressions always terminate and cannot access data outside what is explicitly injected — is a structural auditability guarantee that holds regardless of library.
- **Bundle size:** `@bufbuild/cel` bundled with esbuild produces a `dist/browser.js` of ~272 KB raw / ~68 KB gzipped (including `@bufbuild/re2`; `@bufbuild/cel-spec` tree-shakes out). The regex transpiler it replaces was 16 KB raw / 8 KB gzipped. For comparison, the vendored FactGraph compatibility bridge (`vendor/fg.js`) is 7.1 MB raw / 800 KB gzipped — making `@bufbuild/cel` roughly 12x smaller than FactGraph at the same gzip level. At 68 KB gzipped, the size impact is negligible in a browser context; it is smaller than a typical hero image and well under any reasonable performance budget for a rules engine that states would ship as an alternative to FactGraph.

**Options:**
- **(A)** Keep custom regex transpiler — no additional dependency, but not spec-compliant, limited coverage, eval-based security concern, not maintainable long-term
- **(B) ✓** `@bufbuild/cel` — highest maintenance confidence, official conformance test corpus, fully browser-compatible, covers all required CEL operations
- **(C)** `@marcbachmann/cel-js` — zero dependencies, `check()` API for authoring-time type validation, browser-compatible; reasonable fallback if `@bufbuild/cel` proves problematic

**Decision:** `@bufbuild/cel` (B). The conformance test corpus is the deciding factor — expressions in rules contracts can be validated against the same suite Google uses for `cel-go`, which matters for auditability in a benefits context. Browser compatibility is confirmed (pure-JS RE2 port). The bundle size (~68 KB gzipped) is acceptable and well-justified given that the alternative reference engine (FactGraph) is 12x larger. If static type checking at authoring time becomes a requirement before Buf implements it, `@marcbachmann/cel-js` is the fallback.

**CEL type system note:** CEL is strictly typed — `int` and `double` are distinct types with no implicit coercion. Comparisons between them work (`double >= int` has a defined overload), but arithmetic does not (`double * int` is a type error). Since JavaScript has no integer type, all numeric inputs arrive as CEL `double`. Expressions that mix numeric inputs with integer literals in arithmetic must use explicit casts or float literals: `double(household.size) * 500.0`, not `household.size * 500`. This is a CEL spec requirement, not a library limitation — `@marcbachmann/cel-js` behaves identically.
