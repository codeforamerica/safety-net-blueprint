# Decision Rules DSL

> **Draft status:** this document captures the design rationale agreed during initial design discussion for issue #386. Vendor research (JSM, ServiceNow, IBM Cúram, Salesforce Government Cloud) is still a first pass and should be deepened before this is treated as final. Decisions are marked as agreed but should be revisited if research surfaces a conflict.

This document is the architecture reference for the decision rules DSL — the JSON-based language used to define derived eligibility and benefit calculations that must remain computable from partial data. It is a sibling to [Behavioral Contract DSL](behavioral-contract-dsl.md), not an extension of it: the two share the CEL expression layer but have no other structural overlap. Standards evaluated: OMG DMN. Vendor systems compared: JSM, ServiceNow, IBM Cúram, Salesforce Government Cloud. Prior art evaluated: IRS Direct File's open-source Fact Graph engine (`github.com/IRS-Public/fact-graph`, CC0/public domain).

## Overview

The decision rules DSL defines named, derived values — eligibility determinations, benefit amounts, and other calculated facts — as a dependency graph rather than a one-shot procedural calculation. Its defining property is that a value can be asked for before all of its inputs are known, and the answer reflects that partial state (a real value, a placeholder, or "not yet determinable") rather than failing or requiring the caller to first check completeness by hand. This matters specifically for eligibility screening during intake, where a household's likely eligibility is useful information well before the application is complete.

It is additive to the OpenAPI specs and the behavioral contract DSL in the same way the state machine DSL is: it does not replace field definitions or lifecycle states, it defines derived values computed from them.

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
| 1 | [Dependency graph model for partial evaluation](#decision-1-dependency-graph-model-for-partial-evaluation) | A Fact Graph-inspired dependency graph with three-valued completeness, not a decision-table model, because eligibility screening needs answers from partial data. |
| 2 | [CEL as the derivation expression language](#decision-2-cel-as-the-derivation-expression-language) | Every Derived fact's body is a CEL expression, not a bespoke operator tree — keeps one expression language across the whole blueprint. |
| 3 | [Engine boundary: specification vs. runtime](#decision-3-engine-boundary-specification-vs-runtime) | The blueprint owns the DSL schema and a mock-server reference implementation; the production evaluation engine is not a blueprint contract artifact. |
| 4 | [Implementation language for the reference engine](#decision-4-implementation-language-for-the-reference-engine) | TypeScript, for zero-cross-compilation parity between server and browser execution. |
| 5 | [Client-side vs. server-side execution model](#decision-5-client-side-vs-server-side-execution-model) | Client-side evaluation is advisory only; the server re-runs the same fact dictionary as the authoritative determination. |

---

### Decision 1: Dependency graph model for partial evaluation

**Status:** Decided: B *(pending deeper vendor research)*

**What's being decided:** How eligibility/benefit determination logic should be modeled, given the requirement that a household's eligibility be computable from partial intake data, not only from a complete record.

**Background:** The common commercial pattern for eligibility/decision logic is a decision table (rows of conditions, columns of rules, evaluated as a batch against a complete record) — this is the model behind most rules-engine products in this space, and it has no native way to represent "the record isn't fully known yet, tell me what you can." IRS Direct File's Fact Graph engine takes a different approach: a dependency graph of named facts with explicit three-valued completeness (known/unknown/placeholder) that propagates through derived values.

**Considerations:**
- Decision-table engines are the dominant commercial pattern and are what most case-management vendor ecosystems integrate with, but none of the major platforms compared here (JSM, ServiceNow, IBM Cúram, Salesforce Government Cloud) natively model partial-input completeness as a first-class concept — this is a genuine gap across the industry pattern, not just a gap in one product.
- OMG's DMN standard, the closest thing to a cross-vendor standard for decision tables, has the same limitation: a decision table assumes its inputs are present.
- A dependency-graph model with propagated completeness is a heavier structural commitment than a decision table, but it's the only one of the two that can answer "what's the applicant's likely eligibility so far" mid-interview.

**Options:**
- **(A)** Decision-table model (DMN-aligned, matches dominant vendor pattern) — simpler, familiar, but cannot represent partial input
- **(B) ✓** Dependency-graph model with three-valued completeness (Fact Graph-inspired) — supports partial evaluation, but a genuinely different paradigm from every vendor compared here

**Decision:** Dependency graph (B). This is the one requirement decision tables cannot satisfy regardless of vendor, so the industry-pattern-matching principle doesn't have a real alternative to point to here — this is a deliberate departure from the dominant pattern, made explicitly rather than silently, because partial-result support is the actual point of this work.

**Customization:** A state that wants a decision-table authoring experience over this same fact model (e.g., a table that compiles down to per-output-attribute Derived facts) is a legitimate overlay/tooling layer on top of the dependency graph — not precluded by this decision, just not the baseline authoring format.

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

**Options:**
- **(A)** Blueprint ships and mandates a specific production engine
- **(B) ✓** Blueprint owns the DSL schema and a mock-server reference implementation only; the production engine is a separate concern, implemented by whoever adopts the DSL

**Decision:** Specification only (B), consistent with the existing state machine DSL precedent.

**Customization:** States/adopters may implement the decision-rules DSL with any engine that honors the schema and completeness semantics — this is the intended extensibility point, not a gap.

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

**What's being decided:** How client-side (live, partial) evaluation and server-side (authoritative) evaluation of the same fact dictionary relate to each other.

**Considerations:**
- A live partial-eligibility estimate during intake is valuable applicant-facing UX (the same value Fact Graph provides Direct File's live refund estimate), but a client-side result must never be treated as the actual determination — a client can be tampered with (browser devtools), and the server-visible, verified data is what regulatory determinations must be based on.
- Because the same fact dictionary and engine run in both places, the two results should agree when inputs agree — but only if the client and server are evaluating against the same version of the rules. A policy change between when an applicant starts an application and when they submit it could otherwise cause silent drift.

**Options:**
- **(A)** Treat client-side result as authoritative if the server doesn't re-derive it
- **(B) ✓** Client-side evaluation is advisory-only; the server always re-runs the same fact dictionary against the fully-submitted/verified facts as the authoritative determination; the resolved fact dictionary is versioned and the server validates the version the client evaluated against at submission time

**Decision:** Advisory client, authoritative server (B). This must be stated as an explicit rule for any implementation of this DSL, not left as an implicit assumption, given the regulatory stakes of an eligibility determination.

---

## Customization

### Baseline constraints

| Element | Reason | Decision |
|---|---|---|
| Three-valued completeness propagation | The one capability decision-table engines can't provide; removing it collapses this DSL back into a decision table with extra ceremony | [Decision 1](#decision-1-dependency-graph-model-for-partial-evaluation) |
| CEL as the sole derivation expression language | Keeps one expression language across the whole blueprint contract surface | [Decision 2](#decision-2-cel-as-the-derivation-expression-language) |
| Client-side-advisory / server-side-authoritative rule | Prevents a tampered or stale client result from being treated as a real eligibility determination | [Decision 5](#decision-5-client-side-vs-server-side-execution-model) |

### Engine choice

The blueprint does not mandate an evaluation engine (Decision 3). States/adopters may implement the DSL's completeness and dependency semantics with any engine of their choosing, including a decision-table-style authoring layer on top of the same fact model (see Decision 1's customization note).

## Out of scope

| Capability | Notes |
|---|---|
| The JSON Schema file itself | Scoped to the implementation issue via `/plan`, not this design |
| Reference engine code | Scoped to the implementation issue |
| Any specific adopter's migration from an existing rules engine | Adoption-specific, not baseline blueprint architecture |

## Capability coverage

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Decision-table / rulesheet authoring | Dominant commercial pattern across JSM, ServiceNow, IBM Cúram, Salesforce Government Cloud integrations | **Not in scope** — baseline authoring model is a dependency graph, not a decision table; see Decision 1 |
| Partial/incomplete-input evaluation | Not natively supported by any of the four vendors compared | **Planned** — the core capability this DSL exists to provide; see #386 |
| Vendor-neutral rules specification format | Vendors generally couple rule authoring to their own engine | **Planned** — this DSL is JSON/CEL-based and engine-agnostic; see Decision 3 |

## References

- [IRS Direct File Fact Graph](https://github.com/IRS-Public/fact-graph)
- [Fact Graph 3.1 ADR](https://github.com/IRS-Public/fact-graph/blob/main/docs/fact-graph-3.1-adr.md)
- [Behavioral Contract DSL](behavioral-contract-dsl.md)
- [Google CEL specification](https://github.com/google/cel-spec)
- [OMG DMN](https://www.omg.org/spec/DMN/)
