# Decision Rules DSL

> **Draft status:** this document reflects a substantial research pass (five initial vendor comparisons plus follow-up research on Oracle Intelligent Advisor and Open Policy Agent) but has not yet been reviewed end-to-end. Treat it as a strong working draft, not a final record — some phrasing and decision boundaries may still shift on review.

This document is the architecture reference for the decision rules DSL — the JSON-based language used to define derived eligibility and benefit calculations that must remain computable from partial data. It is a sibling to [Behavioral Contract DSL](behavioral-contract-dsl.md), not an extension of it: the two share the CEL expression layer but have no other structural overlap. Standards evaluated: OMG DMN. Vendor and prior-art systems compared: JSM, ServiceNow, IBM Cúram, Salesforce Government Cloud, Progress Corticon, Oracle Intelligent Advisor (formerly Oracle Policy Automation), Open Policy Agent (Rego), and IRS Direct File's open-source Fact Graph engine (`github.com/IRS-Public/fact-graph`, CC0/public domain).

## Overview

The decision rules DSL defines named, derived values — eligibility determinations, benefit amounts, and other calculated facts — as a dependency graph rather than a one-shot procedural calculation. Its defining property is that a value can be asked for before all of its inputs are known, and the answer reflects that partial state (a real value, a placeholder, or "not yet determinable") rather than failing or requiring the caller to first check completeness by hand. This matters specifically for eligibility screening during intake, where a household's likely eligibility is useful information well before the application is complete.

It is additive to the OpenAPI specs and the behavioral contract DSL in the same way the state machine DSL is: it does not replace field definitions or lifecycle states, it defines derived values computed from them.

## Scope: the rules engine, not the whole eligibility domain

This DSL covers one component of a larger picture: **the rules engine** — a stateless computation that, given a set of known and unknown facts, returns outcomes and identifies what's still needed. It does not cover:

- **State and lifecycle** — tracking a determination's progress over time, opening and resolving blocking factors as verifications and data-exchange results arrive, and managing the eligibility object's lifecycle. That's an orchestration concern, most naturally an extension of the existing state machine DSL ([Behavioral Contract DSL](behavioral-contract-dsl.md)), not this one.
- **Blocking-factor composition from non-engine sources** — many things that prevent a complete determination (a pending referral, an outstanding document, a program-capacity waitlist) never touch the rules engine at all. Composing the full picture from engine output plus these other sources is an orchestration responsibility.
- **Event-driven re-evaluation** — deciding *when* to re-invoke the engine as new information arrives is a stateful, event-driven concern living outside this DSL.

The rules engine is invoked repeatedly, in different modes, by whatever owns that stateful orchestration. See [Invocation modes](#invocation-modes) for the shapes those calls take.

## Contract structure

| Artifact | Purpose | Schema |
|---|---|---|
| `*-decision-rules.yaml` | Named fact declarations (writable and derived), their types, dependencies, and completeness behavior | `packages/contracts/schemas/decision-rules-schema.yaml` *(not yet written — scoped to the implementation issue)* |

Like the state machine DSL, **the decision rules DSL is the specification, not the runtime.** States and adopters implement the actual evaluation engine themselves — the blueprint does not mandate a specific runtime. The mock server carries a reference implementation for development and testing only. See [Decision 3](#decision-3-engine-boundary-specification-vs-runtime).

## Structural model

### Fact

A **Fact** is a named, typed, path-addressable value. Every fact is either:

- **Writable** — supplied directly (an applicant's answer, a caseworker's entry). Analogous to a plain field on a resource, but addressable within the dependency graph.
- **Derived** — computed from other facts via a CEL expression. See [Decision 2](#decision-2-cel-as-the-derivation-expression-language).

Facts are typed (string, number, boolean, date, dollar/currency, enum) and declared once; both the type and the derivation (if any) live in the same declaration.

### Dependency path

Each fact has a path (e.g. `/household/income/totalWages`) that other facts' CEL expressions reference to declare a dependency. The engine resolves dependencies lazily — asking for one derived fact's value only resolves the specific inputs it needs, not the whole graph. This is what makes the model "backward-chaining" rather than a forward, all-at-once evaluation pass.

### Collection

Repeating structures (household members, income sources, expenses) are addressed with a wildcard path segment, resolved per-instance at evaluation time. This mirrors the same repeating-entity pattern already used elsewhere in the blueprint's OpenAPI schemas — the decision rules DSL doesn't invent a new repeating-structure convention, it addresses the existing one.

### Completeness

Every fact resolves to one of three states, not two:

- **Known** — a value is available (written directly, or derived from fully-known inputs).
- **Unknown** — required input(s) haven't been supplied yet.
- **Placeholder** — a default is standing in for a not-yet-known value; facts derived from a placeholder remain marked incomplete even though a computed value is available.

Completeness propagates automatically: a derived fact is only "known" if every fact it depends on is known. This is the property a decision-table engine (evaluated once, against a complete record) cannot express, and it's the reason this DSL exists as a separate artifact type rather than an extension of the existing behavioral contract DSL's condition model. See [Decision 1](#decision-1-dependency-graph-model-for-partial-evaluation).

## Invocation modes

The rules engine is called in at least six distinct modes, each with a different call contract. The DSL and engine need to support all of them; which mode applies on a given call is an orchestration decision, out of scope here (see [Scope](#scope-the-rules-engine-not-the-whole-eligibility-domain)).

| Mode | What it needs from the engine |
|---|---|
| **Formal determination** | Full evaluation; every applicable fact resolved or explicitly marked unknown; the authoritative result |
| **Partial / progressive determination** | Evaluate against whatever facts are currently known; unknown facts are expected output, not an error |
| **What-if projection** | Evaluate against hypothetical inputs, including hypothetical values for facts that are actually still unknown; result is marked as projected, not authoritative |
| **Pre-screening** | Evaluate against minimal input; heavy reliance on completeness tracking to identify what more would be needed for a real determination; result carries no legal weight |
| **QC re-determination** | Evaluate against an immutable historical fact snapshot, using the exact rule-set version in effect on the original determination date — not the current rule set. A discrepancy between this replay and the original outcome is a payment error. This is the same re-derive-and-diff mechanism as any error-rate detection process: run the current (or a pinned historical) fact dictionary against verified facts, and treat any delta from what was actually issued as the finding. |
| **Constrained at-submission evaluation** | Evaluate against submitted-but-unverified facts, treating them as known rather than pending, and suppressing unknown-fact output entirely — used for time-critical flags (e.g., expedited processing screens) that must be set before verification begins |

The last two rows are why the completeness model needs to be a genuine per-fact tri-state rather than a single global "is this determination complete" flag: QC re-determination needs rule-set versioning at the fact-dictionary level, and constrained at-submission evaluation needs the caller to be able to say "treat unknowns as known for this call" without changing the underlying rule definitions.

## Expression layer

Every Derived fact's computation is a single CEL expression string — the same expression language already used for guards, SLA conditions, and metric filters (`behavioral-contract-dsl.md`, Decision 1). See [Decision 2](#decision-2-cel-as-the-derivation-expression-language).

```yaml
facts:
  - path: /household/totalIncome
    type: dollar
    derived: "household.wages + household.selfEmploymentIncome"
  - path: /household/wages
    type: dollar
    writable: true
```

## Key design decisions

| # | Decision | Summary |
|---|---|---|
| 1 | [Dependency graph model for partial evaluation](#decision-1-dependency-graph-model-for-partial-evaluation) | A Fact Graph-inspired dependency graph with three-valued completeness, not a decision-table or forward-chaining model, because eligibility screening needs answers from partial data — and existing open-source backward-chaining engines don't fit this problem's shape either. |
| 2 | [CEL as the derivation expression language](#decision-2-cel-as-the-derivation-expression-language) | Every Derived fact's body is a CEL expression, not a bespoke operator tree — keeps one expression language across the whole blueprint. |
| 3 | [Engine boundary: specification vs. runtime](#decision-3-engine-boundary-specification-vs-runtime) | The blueprint owns the DSL schema and a mock-server reference implementation; the production evaluation engine is not a blueprint contract artifact. |
| 4 | [Implementation language for the reference engine](#decision-4-implementation-language-for-the-reference-engine) | TypeScript, for zero-cross-compilation parity between server and browser execution. |
| 5 | [Client-side vs. server-side execution model](#decision-5-client-side-vs-server-side-execution-model) | Client-side evaluation is advisory only; the server re-runs the same fact dictionary as the authoritative determination. |
| 6 | [Single engine vs. coexisting with an existing engine](#decision-6-single-engine-vs-coexisting-with-an-existing-engine) | The blueprint doesn't require replacing a state's existing rules engine wholesale — running the new engine for partial/what-if/pre-screening modes alongside an existing forward-chaining engine for formal determinations is a legitimate adoption path. |

---

### Decision 1: Dependency graph model for partial evaluation

**Status:** Decided: B *(pending deeper review — see draft status note at top of document)*

**What's being decided:** How eligibility/benefit determination logic should be modeled, given the requirement that a household's eligibility be computable from partial intake data, not only from a complete record.

**Background:** Rule engines split into three architectural families, not two:

- **Forward-chaining** (Drools, IBM ODM/ILOG, FICO Blaze Advisor, IBM Cúram's CER): rules fire when conditions match. A missing input either fails to fire a rule or hits an explicitly-coded fallback — the engine has no inherent notion of what it was looking for.
- **DMN-based** (Camunda, Kogito, IBM ODM in DMN mode): technically forward-chaining, but DMN decision tables declare input columns as part of the model schema, so a well-designed model can introspect what inputs are needed and surface missing ones — without fully solving completeness propagation through derived/dependent values.
- **Backward-chaining / goal-directed** (Oracle Intelligent Advisor, Open Policy Agent, IRS Fact Graph, SWI-Prolog): work in reverse from a goal, enumerating exactly which facts are needed to reach it.

**Considerations:**
- Of the vendors researched, JSM, ServiceNow, and Salesforce Government Cloud all use null-check-style condition/decision-table logic with no first-class "pending" or "placeholder" value — missing data is either a fallback branch or a value the rule author must explicitly check for. None has a native eligibility/benefits-determination product with genuine partial-evaluation support.
- **IBM Cúram** is the closest domain analog and the one real counter-example among the forward-chaining products: its Evidence model supports "provisional determinations" (IBM's own documentation: "any result presented is provisional, dependent upon the client providing supporting documentation") plus e-verification and an evidence-completeness "concerns" list. Critically, this capability lives in the *orchestration/evidence layer wrapping CER*, not in the rules engine itself — CER is still a forward-chaining engine with no native completeness propagation through derived calculations. This is a legitimate, decades-proven alternative architecture: keep a simpler engine, put completeness-tracking in the surrounding system. See [Decision 6](#decision-6-single-engine-vs-coexisting-with-an-existing-engine) for why this doesn't have to be an either/or choice for adopters.
- **Progress Corticon** (decision tables / Rulesheets, single-pass dependency-ordered execution) explicitly recommends the opposite pattern in its own documentation: validation Rulesheets that terminate execution if data is incomplete, rather than attempting a provisional result. It also is not open source.
- **Oracle Intelligent Advisor** (formerly Oracle Policy Automation) is genuine backward-chaining — confirmed via its own documentation: a two-phase cycle that traces the dependency tree backward from a goal attribute to find what's unknown, then forward once facts resolve, with an API that returns "what information is needed to determine the value (if unknown)." This is real, production-proven prior art for exactly the mechanism this DSL wants. It is commercial/proprietary, ruling it out directly, but it validates that the underlying approach works at scale.
- **Open Policy Agent (OPA/Rego)** is a genuine, mature, open-source, backward-chaining engine with an explicit unknown-inputs model — the closest open-source match on architecture. It doesn't fit this problem well regardless: it's built for boolean authorization/policy decisions, not typed numeric calculations with dollar amounts and dependency chains over collections, and it returns residual rule expressions (an abstract syntax tree) rather than caseworker-facing blocking-factor descriptions — which reintroduces the same translation-layer cost that using a backward-chaining engine was supposed to avoid.
- **IRS Fact Graph** is open source (CC0), purpose-built for exactly this shape of problem (typed derived facts, dependency graph, three-state completeness), and reduces the translation-layer burden other engines carry because rules are authored once and consumed directly by both JVM and JavaScript runtimes with no separate translation step.

**Options:**
- **(A)** Forward-chaining engine + orchestration-layer completeness tracking (Cúram's proven pattern) — decades of production use in benefits eligibility, but completeness logic lives outside the engine and must be independently maintained in the orchestrator (explicit rules, an adapter manifest, or both — see Decision 3's discussion of translation-layer cost)
- **(B) ✓** Dependency-graph engine with native three-valued completeness (Fact Graph-inspired) — completeness is a property of the engine itself, not bolted on; no open-source product already does this for typed calculation (as opposed to authorization) use cases
- **(C)** Adopt an existing backward-chaining engine directly — Oracle Intelligent Advisor is commercial (ruled out), OPA/Rego is open source but a capability and output-shape mismatch (authorization-boolean vs. typed calculation; AST output requires the same translation layer we're trying to avoid)

**Decision:** Dependency graph, native completeness (B). Not because no other product has ever solved partial evaluation — Cúram and Oracle Intelligent Advisor both prove the underlying need is real and solvable — but because among the options that fit this DSL's actual requirements (open source, typed calculation rather than boolean authorization, completeness as an engine property rather than an externally-maintained concern), none of the existing products are a fit. This is a deliberate, evaluated departure from the dominant commercial pattern (forward-chaining/decision-table), not an uninformed one.

**Customization:** A state with an existing forward-chaining engine already embedded in their case management platform is not required to replace it — see [Decision 6](#decision-6-single-engine-vs-coexisting-with-an-existing-engine).

---

### Decision 2: CEL as the derivation expression language

**Status:** Decided: B

**What's being decided:** What expression language a Derived fact's computation is written in.

**Background:** Fact Graph's own XML DSL expresses computation as a nested operator tree (`<Add><Dependency path="..."/></Add>`). The blueprint already picked CEL as its sole expression language for guards, SLA conditions, and metric filters (`behavioral-contract-dsl.md`, Decision 1), specifically to avoid the verbosity of a nested tree syntax (that decision rejected JSON Logic for exactly this reason).

**Considerations:**
- A second expression syntax in the blueprint would recreate the exact problem Decision 1 in the behavioral contract DSL was written to prevent — parallel constructs for the same concept.
- CEL already handles arithmetic, comparisons, and list operations cleanly (`totalWages + interestIncome`), with no loss of expressiveness for the arithmetic/comparison operations a Derived fact needs.
- The structural parts of Fact Graph's model worth keeping (facts, dependencies, completeness, collections) are independent of what expression syntax computes a value — adopting the structure doesn't require adopting the syntax.

**Options:**
- **(A)** Bespoke operator tree (Fact Graph's own XML shape, translated to JSON) — matches the reference implementation directly, but reintroduces the verbosity problem CEL was chosen to avoid
- **(B) ✓** CEL expression string per Derived fact — one expression language blueprint-wide

**Decision:** CEL (B). The structural contribution worth taking from Fact Graph is the fact/dependency/completeness model, not its expression syntax.

---

### Decision 3: Engine boundary — specification vs. runtime

**Status:** Decided: B

**What's being decided:** Whether the blueprint ships a production rules-evaluation engine, or only the DSL schema plus a reference implementation.

**Considerations:**
- The state machine DSL already establishes this precedent explicitly: *"States implement the defined behavior in their vendor system of choice... the DSL is the specification, not the runtime. The mock server provides a reference implementation for development and testing."*
- Mandating a specific engine as a baseline blueprint requirement would be an extensibility trade-off inconsistent with the rest of the blueprint's philosophy (contracts are a customizable starting point, not a fixed prescription).
- For forward-chaining engines specifically, the translation layer between a domain's data model and the engine's input/output format carries real, ongoing cost — compensating for missing-input surfacing the engine doesn't provide natively requires explicit rules, an adapter-level manifest, or both, and that logic must stay in sync with the actual rules as they evolve. A native backward-chaining engine with built-in completeness (this DSL's model) reduces that burden but doesn't eliminate the need for *some* translation between the domain's facts and the engine's fact dictionary.

**Options:**
- **(A)** Blueprint ships and mandates a specific production engine
- **(B) ✓** Blueprint owns the DSL schema and a mock-server reference implementation only; the production engine is a separate concern, implemented by whoever adopts the DSL

**Decision:** Specification only (B), consistent with the existing state machine DSL precedent.

**Customization:** States/adopters may implement the decision-rules DSL with any engine that honors the schema and completeness semantics — this is the intended extensibility point, not a gap. See also [Decision 6](#decision-6-single-engine-vs-coexisting-with-an-existing-engine) for running this alongside an existing engine rather than replacing it.

---

### Decision 4: Implementation language for the reference engine

**Status:** Decided: B *(applies to the reference implementation this design work produces, not a blueprint contract requirement — see Decision 3)*

**What's being decided:** What language the reference/production evaluation engine (built outside the blueprint's own contract artifacts) should be implemented in, given a requirement to run identically server-side and client-side for live partial-result UI during intake.

**Considerations:**
- Fact Graph itself needed Scala.js specifically to get browser execution alongside its JVM implementation — a real cross-compilation cost.
- TypeScript/JavaScript runs natively in both Node and the browser with no cross-compilation step at all — the same artifact, not a compile-twice setup.
- Rust compiled to WASM was considered: stronger type/ownership guarantees and better raw performance than TS, but at this workload's scale (a single household's fact graph — tens to low-hundreds of nodes, not bulk data), the performance advantage doesn't materially matter, while the cost (a second toolchain and language the team doesn't otherwise maintain) is real.

**Options:**
- **(A)** Rust → WASM — stronger typing/performance, but a second toolchain/language with no workload-scale benefit here
- **(B) ✓** TypeScript — zero cross-compilation cost for server/browser parity, matches the workload's actual scale requirements

**Decision:** TypeScript (B), specifically because the deciding constraint (browser + server parity) is best satisfied by a language that needs no compilation step to reach the browser at all.

---

### Decision 5: Client-side vs. server-side execution model

**Status:** Decided: B

**What's being decided:** How client-side (live, partial) evaluation and server-side (authoritative) evaluation of the same fact dictionary relate to each other, given the six invocation modes in [Invocation modes](#invocation-modes).

**Considerations:**
- A live partial-eligibility estimate during intake is valuable applicant-facing UX (the same value Fact Graph provides Direct File's live refund estimate) — this corresponds to the partial/progressive and pre-screening invocation modes, and is a reasonable candidate for client-side execution.
- Formal determination, QC re-determination, and constrained at-submission evaluation carry real regulatory and legal weight and must never be client-side-authoritative — a client can be tampered with (browser devtools), and the server-visible, verified data is what regulatory determinations must be based on.
- Because the same fact dictionary and engine run in both places, client and server results should agree when inputs agree — but only if both are evaluating against the same version of the rules. A policy change between when an applicant starts an application and when they submit it could otherwise cause silent drift. This is the same versioning requirement QC re-determination has (pinning to the rule-set version in effect at determination time) — one mechanism should serve both needs.

**Options:**
- **(A)** Treat client-side result as authoritative if the server doesn't re-derive it
- **(B) ✓** Client-side evaluation is advisory-only, restricted to partial/progressive and pre-screening modes; the server always re-runs the same fact dictionary against the fully-submitted/verified facts as the authoritative determination for formal, QC, and constrained at-submission modes; the resolved fact dictionary is versioned and the server validates the version the client evaluated against at submission time

**Decision:** Advisory client, authoritative server (B). This must be stated as an explicit rule for any implementation of this DSL, not left as an implicit assumption, given the regulatory stakes of an eligibility determination.

---

### Decision 6: Single engine vs. coexisting with an existing engine

**Status:** Decided: B

**What's being decided:** Whether adopting this DSL requires a state to replace their existing rules engine entirely, or whether it can run alongside one.

**Background:** Many states already have a forward-chaining engine embedded in their case management platform (Cúram's CER, or similar). Requiring wholesale replacement to get partial/progressive-evaluation support would be a significant, possibly unjustified, migration cost.

**Considerations:**
- A workload-based split is a reasonable adoption path: backward-chaining (this DSL's engine) for pre-screening, what-if projections, and partial/progressive determination during intake or caseworker review; the existing forward-chaining engine stays for official determinations, batch redetermination, and ongoing renewal/lifecycle processing, where forward-chaining's efficient incremental-fact-update model and mature case-lifecycle tooling are genuine strengths.
- Running two engines has real risks: keeping rule content in sync between them (e.g., annual FPL threshold updates must land in both), and resolving which engine's result is authoritative if they ever disagree at a fair hearing. Any adopter choosing this path needs an explicit answer to both before going live.

**Options:**
- **(A)** Require full replacement of any existing rules engine to adopt this DSL
- **(B) ✓** Allow coexistence — this DSL's engine handles the invocation modes it's suited for (partial/progressive, what-if, pre-screening); an existing engine can continue handling formal/official determinations, with an explicit adopter-level answer for rule-sync and disagreement-authority questions

**Decision:** Allow coexistence (B), consistent with the blueprint's extensibility principle — mandating full replacement would impose migration cost this design doesn't need to require.

---

## Customization

### Baseline constraints

| Element | Reason | Decision |
|---|---|---|
| Three-valued completeness propagation | The one capability decision-table and forward-chaining engines can't provide without an external orchestration layer; removing it collapses this DSL back into a decision table with extra ceremony | [Decision 1](#decision-1-dependency-graph-model-for-partial-evaluation) |
| CEL as the sole derivation expression language | Keeps one expression language across the whole blueprint contract surface | [Decision 2](#decision-2-cel-as-the-derivation-expression-language) |
| Client-side-advisory / server-side-authoritative rule | Prevents a tampered or stale client result from being treated as a real eligibility determination | [Decision 5](#decision-5-client-side-vs-server-side-execution-model) |
| Rule-set versioning at the fact-dictionary level | Required for both QC re-determination replay and client/server consistency — the same mechanism serves both | [Decision 5](#decision-5-client-side-vs-server-side-execution-model) |

### Engine choice

The blueprint does not mandate an evaluation engine (Decision 3). States/adopters may implement the DSL's completeness and dependency semantics with any engine of their choosing, including running it alongside an existing forward-chaining engine rather than replacing it (Decision 6).

## Out of scope

| Capability | Notes |
|---|---|
| The JSON Schema file itself | Scoped to the implementation issue via `/plan`, not this design |
| Reference engine code | Scoped to the implementation issue |
| Any specific adopter's migration from an existing rules engine | Adoption-specific, not baseline blueprint architecture |
| Blocking-factor lifecycle, determination state machine, event-driven re-evaluation | Domain orchestration concerns, not this DSL — see [Scope](#scope-the-rules-engine-not-the-whole-eligibility-domain); likely an extension of the existing state machine DSL, not yet designed |

## Capability coverage

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Decision-table / rulesheet authoring | Dominant commercial pattern across JSM, ServiceNow, Salesforce Government Cloud, and Progress Corticon | **Not in scope** — baseline authoring model is a dependency graph, not a decision table; see Decision 1 |
| Partial/incomplete-input evaluation as an engine property | Not native to any decision-table/forward-chaining product researched; IBM Cúram achieves a similar outcome via an orchestration layer over a forward-chaining engine, not the engine itself; Oracle Intelligent Advisor achieves it natively but is commercial | **Planned** — the core capability this DSL exists to provide, achieved as a native engine property rather than bolted on; see #386 |
| Vendor-neutral rules specification format | Vendors generally couple rule authoring to their own engine | **Planned** — this DSL is JSON/CEL-based and engine-agnostic; see Decision 3 |
| Coexistence with an existing case-management-embedded rules engine | Common in practice (e.g., ACA-era MAGI/non-MAGI engine splits) | **Planned** — explicit adoption path, not required to replace an existing engine; see Decision 6 |

## Next steps (informal — not a substitute for `/plan`)

Once this design doc is out of draft, the anticipated implementation sequence is:

1. Finalize this architecture doc (deepen vendor research further if needed, resolve any open design questions from #386).
2. Design the domain orchestrator concern (blocking-factor lifecycle, state machine, event-driven re-evaluation, invocation-mode routing) as its own follow-on design — likely an extension of the existing state machine DSL rather than this one.
3. Write the JSON Schema for the decision-rules artifact (`packages/contracts/schemas/decision-rules-schema.yaml`).
4. One-time bootstrap validation: mine `IRS-Public/fact-graph`'s per-operator test specs and its `exampleAgiFacts.xml`/`ExampleAgiSpec.scala` example for input/expected-output cases, build a narrow JSON-to-their-XML transpiler, and run both engines against the same case matrix (including partial-input cases) as a correctness check before trusting the new engine's mechanics — with extra coverage on collection/wildcard path resolution. Drop the Scala oracle once parity is confirmed.
5. Build the TypeScript reference engine (dependency evaluator, completeness propagation, CEL integration, collections).
6. Wire the reference engine into the mock server as the decision-rules artifact's reference implementation.
7. Author the first real domain decision rules against the finished engine, with no further Fact Graph dependency.

This list is a placeholder for continuity across sessions — the actual phase breakdown should be produced by `/plan` once the design is finalized, not treated as authoritative from here.

## References

- [IRS Direct File Fact Graph](https://github.com/IRS-Public/fact-graph)
- [Fact Graph 3.1 ADR](https://github.com/IRS-Public/fact-graph/blob/main/docs/fact-graph-3.1-adr.md)
- [Behavioral Contract DSL](behavioral-contract-dsl.md)
- [Google CEL specification](https://github.com/google/cel-spec)
- [OMG DMN](https://www.omg.org/spec/DMN/)
- [Oracle Intelligent Advisor: Determinations Engine and the inference cycle](https://docs.oracle.com/html/E79061_01/Content/Introducing%20Oracle%20Policy%20Modeling/Deter_Engine_and_infer_cycle.htm)
- [Open Policy Agent](https://www.openpolicyagent.org/)
