# Decision Rules DSL

> **Draft status:** this document reflects a substantial research pass (five initial vendor comparisons plus follow-up research on Oracle Intelligent Advisor and Open Policy Agent) but has not yet been reviewed end-to-end. Treat it as a strong working draft, not a final record — some phrasing and decision boundaries may still shift on review.

This document is the architecture reference for the decision rules DSL — the JSON-based language used to define derived eligibility and benefit calculations that must remain computable from partial data. It is a sibling to [Behavioral Contract DSL](behavioral-contract-dsl.md), not an extension of it: the two share the CEL expression layer but have no other structural overlap. Standards evaluated: OMG DMN. Vendor and prior-art systems compared: JSM, ServiceNow, IBM Cúram, Salesforce Government Cloud, Progress Corticon, Oracle Intelligent Advisor (formerly Oracle Policy Automation), Open Policy Agent (Rego), and IRS Direct File's open-source Fact Graph engine (`github.com/IRS-Public/fact-graph`, CC0/public domain).

## Overview

The decision rules DSL defines named, derived values — eligibility determinations, benefit amounts, and other calculated facts — as a dependency graph rather than a one-shot procedural calculation. Its defining property is that a value can be asked for before all of its inputs are known, and the answer reflects that partial state (a real value, a placeholder, or "not yet determinable") rather than failing or requiring the caller to first check completeness by hand. This matters specifically for eligibility screening during intake, where a household's likely eligibility is useful information well before the application is complete.

It is additive to the OpenAPI specs and the behavioral contract DSL in the same way the state machine DSL is: it does not replace field definitions or lifecycle states, it defines derived values computed from them.

**Why not just use IRS Fact Graph as-is?** Its structural model (facts, dependency graph, completeness) is what this DSL borrows — see [Decision 1](#decision-1-dependency-graph-model-for-partial-evaluation). Whether to adopt its actual runtime, or build a new engine on the same ideas, is a separate question — see [Decision 2](#decision-2-build-a-new-engine-vs-adopting-fact-graphs-actual-runtime).

## Scope: the rules engine, not the whole eligibility domain

This DSL covers one component of a larger picture: **the rules engine** — a stateless computation that, given a set of known and unknown facts, returns outcomes and identifies what's still needed. It does not cover the stateful orchestration around it — state and lifecycle, blocking-factor composition, event-driven re-evaluation. That orchestration is not a hypothetical future concern: it substantially already exists as the [Eligibility domain](../domains/eligibility.md) — the `Determination`/`Decision` entity model, `eligibility-state-machine.yaml`, and the evaluate endpoints that trigger trial and official rules-engine runs (Eligibility domain, Decision 15).

The Eligibility domain has also already made this DSL's Decision 5 for its own scope, independently: [Decision 11](../domains/eligibility.md#decision-11-eligibility-rules-engine-scope) states that program eligibility rules are adapter-layer — the blueprint contracts the data model, API surface, and events, not the rules content — for the same reason this DSL reaches the same conclusion (states already run Cúram, Pega, Drools, Corticon; a contracted rules interface would constrain adapter choice without adding value). The [eligibility adapter](../domains/eligibility.md) (`eligibility-adapter-openapi.yaml`) is the already-defined integration point: this DSL's engine is a candidate implementation behind that existing contract, not a new integration surface.

What genuinely isn't covered yet by the Eligibility domain as designed: live, client-side partial/progressive evaluation during active data entry (as opposed to caseworker-triggered evaluate calls), and pre-application pre-screening. Those are this DSL's actual incremental contribution — see [Invocation modes](#invocation-modes) for how they relate to what already exists.

## Contract structure

| Artifact | Purpose | Schema |
|---|---|---|
| `*-decision-rules.yaml` | Named fact declarations (writable and derived), their types, dependencies, and completeness behavior | `packages/contracts/schemas/decision-rules-schema.yaml` *(not yet written — scoped to the implementation issue)* |

Like the state machine DSL, **the decision rules DSL is the specification, not the runtime.** States and adopters implement the actual evaluation engine themselves — the blueprint does not mandate a specific runtime. The mock server carries a reference implementation for development and testing only. See [Decision 5](#decision-5-engine-boundary-specification-vs-runtime).

## Structural model

### Fact

A **Fact** is a named, typed, path-addressable value. Every fact is either:

- **Writable** — supplied directly (an applicant's answer, a caseworker's entry). Analogous to a plain field on a resource, but addressable within the dependency graph. A Writable fact may also declare a **placeholder** (a default value used when the fact hasn't been set — facts derived from it stay marked incomplete even though a computed value is available), an **override** (a condition under which a different value supersedes what was submitted), and **limits** (min/max bounds on the value).
- **Derived** — computed from other facts via a CEL expression. See [Decision 3](#decision-3-cel-as-the-derivation-expression-language).

Facts are typed and declared once; both the type and the derivation (if any) live in the same declaration. The type registry is not a fixed enum baked into the schema — it's extensible, so a type can be added later without a breaking schema change. The starting set carries over the full type system observed in Fact Graph's actual implementation, not a hand-picked subset: `boolean`, `int`, `string`, `dollar`, `day`, `days` (date difference), `rational`, `enum`, `multiEnum`, `address`, `bankAccount`, `phoneNumber`, `email`, `ein`, `tin`, `pin`/`ipPin`, plus `collection` for repeating structures (see [Collection](#collection) below). Some of these (`ein`, `tin`, `pin`) are IRS/tax-identity-specific and may never see real use in this domain, but nothing is excluded on the assumption it won't be needed — the type registry being extensible means there's no cost to carrying a type forward that turns out to be unused, and no schema migration required if one turns out to be needed after all.

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

| Mode | What it needs from the engine | Existing counterpart |
|---|---|---|
| **Formal determination** | Full evaluation; every applicable fact resolved or explicitly marked unknown; the authoritative result | Official evaluate runs (Eligibility domain, Decision 15) |
| **Partial / progressive determination** | Evaluate against whatever facts are currently known; unknown facts are expected output, not an error | Not yet covered — the Eligibility domain's trial runs are caseworker-triggered, not live during active data entry; this is this DSL's actual new contribution |
| **What-if projection** | Evaluate against hypothetical inputs, including hypothetical values for facts that are actually still unknown; result is marked as projected, not authoritative | Trial evaluate runs (Eligibility domain, Decision 15) — same shape, projected outcomes without updating Decision status |
| **Pre-screening** | Evaluate against minimal input; heavy reliance on completeness tracking to identify what more would be needed for a real determination; result carries no legal weight | Not yet covered — pre-application, before an Application/Determination record exists at all; this DSL's other new contribution |
| **QC re-determination** | Evaluate against an immutable historical fact snapshot, using the exact rule-set version in effect on the original determination date — not the current rule set. A discrepancy between this replay and the original outcome is a payment error. This is the same re-derive-and-diff mechanism as any error-rate detection process: run the current (or a pinned historical) fact dictionary against verified facts, and treat any delta from what was actually issued as the finding. | Not designed in the Eligibility domain as it stands |
| **Constrained at-submission evaluation** | Evaluate against submitted-but-unverified facts, treating them as known rather than pending, and suppressing unknown-fact output entirely — used for time-critical flags (e.g., expedited processing screens) that must be set before verification begins | Already real and already specified: expedited SNAP screening and Medicaid ex parte evaluation (Eligibility domain, "What happens during eligibility determination" steps 1–2) match this description closely — submitted data only, no blocking factors for missing verification |

The last two rows in the table above (QC re-determination, constrained at-submission) are why the completeness model needs to be a genuine per-fact tri-state rather than a single global "is this determination complete" flag: QC re-determination needs rule-set versioning at the fact-dictionary level, and constrained at-submission evaluation needs the caller to be able to say "treat unknowns as known for this call" without changing the underlying rule definitions.

Two of the six modes (formal determination, constrained at-submission) and a close match on a third (what-if ≈ trial runs) already have real, specified counterparts in the Eligibility domain — this DSL isn't inventing all six from nothing. The genuinely new modes are partial/progressive determination during live data entry and pre-screening before an application exists.

## Expression layer

Every Derived fact's computation is a single CEL expression string — the same expression language already used for guards, SLA conditions, and metric filters (`behavioral-contract-dsl.md`, Decision 1). See [Decision 3](#decision-3-cel-as-the-derivation-expression-language) for the choice of CEL itself, and [Decision 4](#decision-4-currency-precision-in-cel-expressions) for how currency arithmetic is handled given CEL's native numeric types.

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
| 2 | [Build a new engine vs. adopting Fact Graph's actual runtime](#decision-2-build-a-new-engine-vs-adopting-fact-graphs-actual-runtime) | Borrow Fact Graph's semantics, not its code, syntax, or runtime — its main asset (tax-law hardening) doesn't transfer to this domain, while its toolchain, leaky API, and XML syntax would all be inherited costs. |
| 3 | [CEL as the derivation expression language](#decision-3-cel-as-the-derivation-expression-language) | Every Derived fact's body is a CEL expression, not a bespoke operator tree — keeps one expression language across the whole blueprint. |
| 4 | [Currency precision in CEL expressions](#decision-4-currency-precision-in-cel-expressions) | CEL has no native arbitrary-precision decimal type; dollar arithmetic is handled via custom CEL functions/types rather than native floating-point operators, chosen for its extensibility to other gaps found later. |
| 5 | [Engine boundary: specification vs. runtime](#decision-5-engine-boundary-specification-vs-runtime) | The blueprint owns the DSL schema and a mock-server reference implementation; the production evaluation engine is not a blueprint contract artifact. |
| 6 | [Implementation language for the reference engine](#decision-6-implementation-language-for-the-reference-engine) | TypeScript, for zero-cross-compilation parity between server and browser execution. |
| 7 | [Client-side vs. server-side execution model](#decision-7-client-side-vs-server-side-execution-model) | Client-side evaluation is advisory only; the server re-runs the same fact dictionary as the authoritative determination. |
| 8 | [Is full engine replacement required to adopt this DSL?](#decision-8-is-full-engine-replacement-required-to-adopt-this-dsl) | Not required as a prerequisite — the one well-justified reason for temporary coexistence is using the existing engine to vet the new engine's determinations during migration, not a permanent workload split. |

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
- **IBM Cúram** is the closest domain analog and the one real counter-example among the forward-chaining products: its Evidence model supports "provisional determinations" (IBM's own documentation: "any result presented is provisional, dependent upon the client providing supporting documentation") plus e-verification and an evidence-completeness "concerns" list. Critically, this capability lives in the *orchestration/evidence layer wrapping CER*, not in the rules engine itself — CER is still a forward-chaining engine with no native completeness propagation through derived calculations. This is a legitimate, decades-proven alternative architecture: keep a simpler engine, put completeness-tracking in the surrounding system. See [Decision 8](#decision-8-is-full-engine-replacement-required-to-adopt-this-dsl) for the narrow, performance-driven case where an adopter might keep both approaches running rather than a full switch.
- **Progress Corticon** (decision tables / Rulesheets, single-pass dependency-ordered execution) explicitly recommends the opposite pattern in its own documentation: validation Rulesheets that terminate execution if data is incomplete, rather than attempting a provisional result. It also is not open source.
- **Oracle Intelligent Advisor** (formerly Oracle Policy Automation) is genuine backward-chaining — confirmed via its own documentation: a two-phase cycle that traces the dependency tree backward from a goal attribute to find what's unknown, then forward once facts resolve, with an API that returns "what information is needed to determine the value (if unknown)." This is real, production-proven prior art for exactly the mechanism this DSL wants. It is commercial/proprietary, ruling it out directly, but it validates that the underlying approach works at scale.
- **Open Policy Agent (OPA/Rego)** is a genuine, mature, open-source, backward-chaining engine with an explicit unknown-inputs model — the closest open-source match on architecture. It doesn't fit this problem well regardless: it's built for boolean authorization/policy decisions, not typed numeric calculations with dollar amounts and dependency chains over collections, and it returns residual rule expressions (an abstract syntax tree) rather than caseworker-facing blocking-factor descriptions — which reintroduces the same translation-layer cost that using a backward-chaining engine was supposed to avoid.
- **IRS Fact Graph** is open source (CC0), purpose-built for exactly this shape of problem (typed derived facts, dependency graph, three-state completeness), and reduces the translation-layer burden other engines carry because rules are authored once and consumed directly by both JVM and JavaScript runtimes with no separate translation step.

**Options:**
- **(A)** Forward-chaining engine + orchestration-layer completeness tracking (Cúram's proven pattern) — decades of production use in benefits eligibility, but completeness logic lives outside the engine and must be independently maintained in the orchestrator (explicit rules, an adapter manifest, or both — see Decision 5's discussion of translation-layer cost)
- **(B) ✓** Dependency-graph engine with native three-valued completeness (Fact Graph-inspired) — completeness is a property of the engine itself, not bolted on; no open-source product already does this for typed calculation (as opposed to authorization) use cases
- **(C)** Adopt an existing backward-chaining engine directly — Oracle Intelligent Advisor is commercial (ruled out), OPA/Rego is open source but a capability and output-shape mismatch (authorization-boolean vs. typed calculation; AST output requires the same translation layer we're trying to avoid)

**Decision:** Dependency graph, native completeness (B). Not because no other product has ever solved partial evaluation — Cúram and Oracle Intelligent Advisor both prove the underlying need is real and solvable — but because among the options that fit this DSL's actual requirements (open source, typed calculation rather than boolean authorization, completeness as an engine property rather than an externally-maintained concern), none of the existing products are a fit. This is a deliberate, evaluated departure from the dominant commercial pattern (forward-chaining/decision-table), not an uninformed one.

**Customization:** A state with an existing forward-chaining engine already embedded in their case management platform is not required to replace it before adopting this DSL — see [Decision 8](#decision-8-is-full-engine-replacement-required-to-adopt-this-dsl), which narrows this to a specific, conditional case rather than a general dual-engine recommendation.

---

### Decision 2: Build a new engine vs. adopting Fact Graph's actual runtime

**Status:** Decided: B

**What's being decided:** Given that IRS Fact Graph already exists, is open source (CC0), and fits the architecture family chosen in Decision 1, whether to adopt its actual Scala/Scala.js runtime directly — rather than building a new engine that borrows its semantics but not its code.

**Considerations:**
- Fact Graph's biggest practical asset — years of production hardening against tax-law edge cases — is domain-specific to tax and doesn't transfer to safety-net eligibility rules. Adopting it would mean carrying its Scala/JVM/Scala.js toolchain as an ongoing dependency without the one benefit that would justify that cost.
- Fact Graph's own maintainers describe its Java/JavaScript consumption API as leaky and undocumented (e.g., `DollarWrapper` vs. `Dollar` exposed as separate types) — an acknowledged wart in their own architecture decision record, not a hypothetical concern.
- Its XML authoring format is a nested operator tree — the same verbosity problem CEL was chosen elsewhere in this blueprint specifically to avoid (see [Decision 3](#decision-3-cel-as-the-derivation-expression-language)).
- Its Scala.js browser target requires a cross-compilation step; a new TypeScript implementation gets browser + server parity natively, with no separate compile step at all (see [Decision 6](#decision-6-implementation-language-for-the-reference-engine)).
- Fact Graph itself doesn't restrict a system to a single engine — nothing in its code prevents running another engine alongside it. But Direct File's use of it never needed to address coexistence with another rules engine, so Fact Graph has no native concept of routing between engines or reconciling two engines' results. That's an absence in what it was built for, not a constraint it imposes. This design doesn't need to *require* multi-engine support either — it just shouldn't foreclose it by mandating a single engine as a baseline requirement (see [Decision 8](#decision-8-is-full-engine-replacement-required-to-adopt-this-dsl)).
- The risk of building new rather than adopting: losing Fact Graph's own hardening around subtle mechanics — collection/wildcard path resolution has needed a bug fix as recently as their own March 2026 release, evidence this is a genuinely tricky area even for the original team. Mitigated by a one-time bootstrap validation against the real Fact Graph engine before any real rule authoring begins (see [Next steps](#next-steps-informal--not-a-substitute-for-plan)), rather than an ongoing dependency.

**Options:**
- **(A)** Adopt Fact Graph's actual runtime (Scala/Scala.js), directly or via a thin wrapper — inherits its production hardening, but that hardening is tax-specific and doesn't transfer; carries a permanent JVM/Scala.js toolchain dependency; inherits its acknowledged leaky API and XML verbosity
- **(B) ✓** Build a new engine borrowing Fact Graph's semantics (the fact/dependency/completeness model) but not its code, syntax, or runtime — no ongoing foreign-toolchain dependency, a clean API designed from scratch, CEL instead of XML, native browser/server parity, and explicit support for coexisting with another engine; validated once against the real Fact Graph engine as a bootstrap correctness check rather than an ongoing dependency

**Decision:** Build new (B). What's being adopted from Fact Graph is the *idea* — a dependency graph of typed facts with native completeness tracking — not the artifact. Everything Fact Graph would bring along with itself (a foreign toolchain, an acknowledged-leaky API, an XML authoring format inconsistent with the rest of this blueprint, an architecture that assumes it's the only engine) is friction without a matching benefit once the domain isn't tax.

---

### Decision 3: CEL as the derivation expression language

**Status:** Decided: B

**What's being decided:** What expression language a Derived fact's computation is written in.

**Background:** Fact Graph's own XML DSL expresses computation as a nested operator tree (`<Add><Dependency path="..."/></Add>`). The blueprint already picked CEL as its sole expression language for guards, SLA conditions, and metric filters (`behavioral-contract-dsl.md`, Decision 1), specifically to avoid the verbosity of a nested tree syntax (that decision rejected JSON Logic for exactly this reason).

**Considerations:**
- Flat, infix expression text is more readable than a nested operator tree for the same logic — compare `totalWages + interestIncome > 50000` to the equivalent tree of tagged nodes (`<GreaterThan><Add>...</Add><Int>50000</Int></GreaterThan>`). This is the same reason virtually every general-purpose programming language uses infix arithmetic syntax rather than requiring hand-authored parse trees — it's an independent readability argument, not specific to what this blueprint already does elsewhere, and it holds regardless of who's authoring the expression.
- A nested tree structure also produces a much larger diff footprint for a structural logic change (adding a term to a sum, or changing what depends on what means adding/removing whole nested blocks, not editing one line) — a real cost for change review in a system where rule changes need to be auditable.
- Separately, this also avoids introducing a second expression syntax alongside CEL's existing use for guards, SLA conditions, and metric filters (`behavioral-contract-dsl.md`, Decision 1) — but that's a supporting consistency benefit, not the primary reason.
- The structural parts of Fact Graph's model worth keeping (facts, dependencies, completeness, collections) are independent of what expression syntax computes a value — adopting the structure doesn't require adopting the syntax.
- CEL's native type system doesn't cover everything Fact Graph's own type system does (most notably currency precision) — see [Decision 4](#decision-4-currency-precision-in-cel-expressions) for how that gap is closed without abandoning CEL.

**Known gap:** whether CEL is genuinely approachable for non-engineer rule authors (as opposed to just "less bad than a nested tree") isn't established here. The existing `behavioral-contract-dsl.md` Decision 1 asserts policy staff write CEL condition strings via overlay, but that claim isn't backed by usability research in this document or, as far as this design knows, anywhere else — it may be an inherited assumption rather than a tested one. The most directly comparable prior art for genuinely non-technical rule authoring (Oracle Policy Automation's natural-language if/then statements in Word/Excel) is a much bigger step toward non-engineer accessibility than CEL's C-like syntax is. This decision doesn't depend on CEL being non-engineer-friendly — the readability and diff-footprint reasoning above holds either way — but it shouldn't be overstated as a benefit this design has evidence for.

**Options:**
- **(A)** Bespoke operator tree (Fact Graph's own XML shape, translated to JSON) — trivially safe to generate/validate programmatically since it's already structured data rather than text requiring a parser, but meaningfully more verbose and harder to review for the reasons above
- **(B) ✓** CEL expression string per Derived fact — more readable, smaller diffs for structural changes, and incidentally keeps one expression language blueprint-wide

**Decision:** CEL (B), for readability and diff footprint — reasoning that holds regardless of who's authoring the expression, not contingent on an unverified claim about non-engineer accessibility. The structural contribution worth taking from Fact Graph is the fact/dependency/completeness model, not its expression syntax.

---

### Decision 4: Currency precision in CEL expressions

**Status:** Decided: B

**What's being decided:** How Derived facts express dollar-amount arithmetic, given that CEL's native numeric types (`int64`, `uint64`, `double`) don't include an arbitrary-precision decimal type, while Fact Graph's own `Dollar` type is deliberately implemented as a `BigDecimal` specifically to avoid floating-point rounding error in benefit calculations.

**Background:** This is the one place where adopting CEL (Decision 3) doesn't get full parity with Fact Graph's type system for free. Doing dollar arithmetic in CEL's native `double` risks the same cumulative rounding error BigDecimal exists to prevent — a real concern for a system computing benefit amounts to the cent.

**Considerations:**
- Representing money as integer cents keeps arithmetic exact using CEL's native `int64` type, with no extension work required. But it puts a silent unit-convention burden on every rule author and consumer (is this value dollars or cents?), and doesn't generalize — it only solves the currency case, not any other precision- or type-specific gap between CEL and Fact Graph's type system that turns up later.
- CEL is explicitly designed to be extended with custom functions and types registered in its evaluation environment — this is a supported extension mechanism, not a workaround. A `Dollar` type backed by real decimal arithmetic, with functions for add/subtract/multiply/divide/round, can match Fact Graph's actual currency semantics (including its rounding-mode-specific behavior on operations like Ceiling/Floor) rather than approximating it.
- The custom-function approach establishes a reusable pattern: whatever other Fact Graph-specific behavior turns out not to map cleanly onto CEL's native operators (as they're discovered during implementation) gets closed the same way, rather than needing a new one-off convention each time.

**Options:**
- **(A)** Represent money as integer cents, relying only on CEL's native `int64` arithmetic — simplest, no extension work, but a silent unit-convention burden on every rule author and doesn't generalize to other gaps
- **(B) ✓** Register custom CEL functions/types for decimal-safe currency arithmetic — more upfront implementation work, but matches Fact Graph's actual `Dollar` semantics precisely and establishes a reusable extension pattern for whatever else comes up

**Decision:** Custom CEL extensions (B), chosen specifically for the extensibility: this doesn't just solve currency precision, it establishes how any future CEL-vs-Fact-Graph type gap gets closed, rather than needing a bespoke workaround each time one is found. This is the same extensibility principle behind the fact type registry itself (see [Fact](#fact) in the Structural Model) — types and their CEL-level operations are both meant to grow as gaps are found, not to be fixed at design time.

---

### Decision 5: Engine boundary — specification vs. runtime

**Status:** Decided: B

**What's being decided:** Whether the blueprint ships a production rules-evaluation engine, or only the DSL schema plus a reference implementation.

**Considerations:**
- The state machine DSL already establishes this precedent explicitly: *"States implement the defined behavior in their vendor system of choice... the DSL is the specification, not the runtime. The mock server provides a reference implementation for development and testing."*
- The Eligibility domain has independently reached the identical conclusion for this exact concern: [Decision 11](../domains/eligibility.md#decision-11-eligibility-rules-engine-scope) states "program eligibility rules are adapter-layer; the blueprint defines data model, API, and events, not eligibility criteria," for the same underlying reason (states already run Cúram, Pega, Drools, Corticon; a contracted rules interface would constrain adapter choice). This isn't a novel argument being made for the first time here — it's the second domain to land on the same answer independently, and the eligibility adapter contract (`eligibility-adapter-openapi.yaml`) is the concrete precedent for what that boundary looks like in practice.
- Mandating a specific engine as a baseline blueprint requirement would be an extensibility trade-off inconsistent with the rest of the blueprint's philosophy (contracts are a customizable starting point, not a fixed prescription).
- For forward-chaining engines specifically, the translation layer between a domain's data model and the engine's input/output format carries real, ongoing cost — compensating for missing-input surfacing the engine doesn't provide natively requires explicit rules, an adapter-level manifest, or both, and that logic must stay in sync with the actual rules as they evolve. A native backward-chaining engine with built-in completeness (this DSL's model) reduces that burden but doesn't eliminate the need for *some* translation between the domain's facts and the engine's fact dictionary.

**Options:**
- **(A)** Blueprint ships and mandates a specific production engine
- **(B) ✓** Blueprint owns the DSL schema and a mock-server reference implementation only; the production engine is a separate concern, implemented by whoever adopts the DSL

**Decision:** Specification only (B), consistent with the existing state machine DSL precedent.

**Customization:** States/adopters may implement the decision-rules DSL with any engine that honors the schema and completeness semantics — this is the intended extensibility point, not a gap. See also [Decision 8](#decision-8-is-full-engine-replacement-required-to-adopt-this-dsl) for the narrow, temporary case where running this alongside an existing engine is justified (migration-time shadow-validation), rather than a general license to run two engines indefinitely.

---

### Decision 6: Implementation language for the reference engine

**Status:** Decided: B *(applies to the reference implementation this design work produces, not a blueprint contract requirement — see Decision 5)*

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

### Decision 7: Client-side vs. server-side execution model

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

### Decision 8: Is full engine replacement required to adopt this DSL?

**Status:** Decided: B

**What's being decided:** Whether a state must fully replace their existing rules engine before they can start adopting this DSL at all — not whether running two engines long-term is good architecture. Those are separate questions, and this decision only answers the first one.

**Background:** Many states already have a forward-chaining engine embedded in their case management platform (Cúram's CER, or similar). The real-world precedent for long-term dual-engine operation — the ACA-era MAGI/non-MAGI split (e.g., CalHEERS for MAGI/marketplace, CalSAWS for everything else) — is a cautionary example, not a validating one: states mostly ended up there by accident (forced by the MAGI/non-MAGI split), not by deliberate design, and it carries documented, serious risk.

**Considerations:**
- Requiring full replacement before any adoption can begin is a real barrier — a state with significant existing investment in an engine can't reasonably be asked to rip it out on day one just to get partial/progressive-evaluation support.
- Running two engines *permanently* is not something this design should recommend. The real risks are serious for a system determining legally binding benefits: rule content can drift out of sync between engines (e.g., an annual FPL threshold update landing in one but not the other), and there's no inherent answer for which engine's result is authoritative if they disagree at a fair hearing. These aren't hypothetical — they're the documented failure modes of the precedent this decision is drawing on.
- There is, however, one well-justified reason for *temporary* coexistence, distinct from either general migration reluctance or an assumed batch-performance need: using a state's existing, trusted, production engine as an oracle to vet the new engine's determinations before relying on it — the same class of technique as golden-master/parity testing generally, and the same pattern Decision 2 uses the actual Fact Graph engine for as a one-time correctness check on the new engine's core mechanics. Two complementary checks serve this: **(1)** partial-vs-partial — comparing the new engine's partial/progressive result against whatever interim logic the existing engine produces from the same known facts, catching mismatches as soon as they're computable; and **(2)** partial-vs-eventual-full — retroactively checking whether the new engine's earlier partial result, computed while a case was still incomplete, was consistent with what the case's existing-engine-computed full determination eventually resolved to, catching a different class of drift (an assumption that looked locally correct but wasn't once more facts arrived). This has the clean exit condition general "keep it around" reasoning lacks: once the new engine's outputs are shown trustworthy across enough real cases by both checks, the comparison stops and the existing engine is no longer needed for this purpose. The specific harness for running these checks is adopter-specific migration tooling, out of scope for this document (see [Out of scope](#out-of-scope)) — what belongs here is the principle that this is the legitimate reason to allow temporary coexistence at all.
- A second possible reason sometimes raised — the new engine not scaling to batch/bulk workloads (mass redeterminations across a whole caseload) — is speculative and shouldn't be assumed. It's a performance-engineering problem to solve within a single engine first (parallelizing across independent cases, incremental/memoized re-evaluation rather than full graph recomputation per run) rather than a default reason to plan for a second engine.

**Options:**
- **(A)** Require full replacement of any existing rules engine before adopting this DSL — avoids all coexistence risk, but blocks incremental adoption and forecloses shadow-validation as a migration strategy entirely
- **(B) ✓** Don't require full replacement as a prerequisite to adopt this DSL — but the only well-justified reason for temporary coexistence is shadow-validation during migration (with an explicit exit condition once trust is established across both partial-vs-partial and partial-vs-eventual-full checks), not a permanent workload split and not an assumed batch-performance limitation

**Decision:** Don't require full replacement (B), narrowed specifically to migration-time shadow-validation as the legitimate case for temporary coexistence. This is not an endorsement of dual-engine operation as good architecture, and not a workload-split design. Batch-scale performance is treated as an engine-design problem to solve first, not a reason to plan for a second engine — see [Decision 6](#decision-6-implementation-language-for-the-reference-engine).

---

## Customization

### Baseline constraints

| Element | Reason | Decision |
|---|---|---|
| Three-valued completeness propagation | The one capability decision-table and forward-chaining engines can't provide without an external orchestration layer; removing it collapses this DSL back into a decision table with extra ceremony | [Decision 1](#decision-1-dependency-graph-model-for-partial-evaluation) |
| CEL as the sole derivation expression language | Keeps one expression language across the whole blueprint contract surface | [Decision 3](#decision-3-cel-as-the-derivation-expression-language) |
| Client-side-advisory / server-side-authoritative rule | Prevents a tampered or stale client result from being treated as a real eligibility determination | [Decision 7](#decision-7-client-side-vs-server-side-execution-model) |
| Rule-set versioning at the fact-dictionary level | Required for both QC re-determination replay and client/server consistency — the same mechanism serves both | [Decision 7](#decision-7-client-side-vs-server-side-execution-model) |

### Engine choice

The blueprint does not mandate an evaluation engine (Decision 5). States/adopters may implement the DSL's completeness and dependency semantics with any engine of their choosing. Full replacement of an existing engine is not required before adoption can begin — the one well-justified reason to temporarily run both is migration-time shadow-validation, not a permanent split (Decision 8).

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
| Vendor-neutral rules specification format | Vendors generally couple rule authoring to their own engine | **Planned** — this DSL is JSON/CEL-based and engine-agnostic; see Decision 5 |
| Permanent coexistence with an existing case-management-embedded rules engine | Common in practice, but mostly by accident rather than design (e.g., ACA-era MAGI/non-MAGI engine splits), with documented rule-sync and fair-hearing-authority risks | **Not in scope** — not a recommended architecture; see Decision 8 |
| Migration-time shadow-validation against an existing engine | Not a named industry pattern, but the same class of technique as golden-master/parity testing generally | **Planned** — the one justified reason for temporary coexistence, with an explicit exit condition; see Decision 8 |

## Next steps (informal — not a substitute for `/plan`)

Once this design doc is out of draft, the anticipated implementation sequence is:

1. Finalize this architecture doc (deepen vendor research further if needed, resolve any open design questions from #386).
2. Write the JSON Schema for the decision-rules artifact (`packages/contracts/schemas/decision-rules-schema.yaml`), including the custom CEL currency-arithmetic functions/types from Decision 4.
3. One-time bootstrap validation: mine `IRS-Public/fact-graph`'s per-operator test specs and its `exampleAgiFacts.xml`/`ExampleAgiSpec.scala` example for input/expected-output cases, build a narrow JSON-to-their-XML transpiler, and run both engines against the same case matrix (including partial-input cases) as a correctness check before trusting the new engine's mechanics — with extra coverage on collection/wildcard path resolution. Drop the Scala oracle once parity is confirmed. **Note: this transpiler is scoped only to the operators exercised by mined test cases and is not the same tool as item 4 below — it's throwaway, not an authoring aid.**
4. Consider a general-purpose, bidirectional XML ↔ JSON converter as a separate, ongoing tool (not the throwaway one in item 3) — this would let someone already fluent in Fact Graph's XML fact-dictionary syntax author or read rules in a familiar format without learning our JSON DSL from scratch. Unlike the bootstrap transpiler, this needs to cover the full syntax surface anyone might reasonably author with, handle edge cases gracefully, and give useful error messages, since real people would depend on it rather than an internal test harness alone. Whether this is worth building — and whether it should be bidirectional or one-directional — is an open question, not yet decided; it's a convenience/onboarding tool, not a structural requirement of the DSL itself.
5. Build the TypeScript reference engine (dependency evaluator, completeness propagation, CEL integration including the currency extensions, collections).
6. Wire the reference engine into the mock server as the decision-rules artifact's reference implementation.
7. Author the first real domain decision rules against the finished engine, with no further Fact Graph dependency.

**Open question, not yet decided:** how do we notice if `IRS-Public/fact-graph` fixes something (e.g., a bug in collection/wildcard path resolution) after our own bootstrap validation (item 3) is done and the Scala oracle is dropped? Once we stop running their engine, we lose the natural signal that would otherwise surface a mismatch. Options worth evaluating: their repo's commit Atom feed, a scheduled check against their latest commit SHA (possibly scoped to just the `compnodes`/`types` directories to cut noise), or a GitHub Actions workflow that opens a tracking issue when their `main` moves. Not resolved here — needs a decision before or shortly after item 3.

**Independent of the sequence above:** the stateful orchestration this DSL depends on isn't a from-scratch design — it substantially already exists as the [Eligibility domain](../domains/eligibility.md) (`Determination`/`Decision` entities, `eligibility-state-machine.yaml`, the `eligibility-adapter-openapi.yaml` adapter contract). The real follow-on work is *extending* that existing domain to support the two genuinely new invocation modes (live partial/progressive evaluation, pre-screening) — not designing an orchestrator that doesn't exist yet. Nothing in steps 1–7 depends on that extension being done first, since this DSL's schema and engine are self-contained; it can be scheduled independently, not as a blocking prerequisite.

This list is a placeholder for continuity across sessions — the actual phase breakdown should be produced by `/plan` once the design is finalized, not treated as authoritative from here.

## References

- [IRS Direct File Fact Graph](https://github.com/IRS-Public/fact-graph)
- [Fact Graph 3.1 ADR](https://github.com/IRS-Public/fact-graph/blob/main/docs/fact-graph-3.1-adr.md)
- [Behavioral Contract DSL](behavioral-contract-dsl.md)
- [Eligibility Domain](../domains/eligibility.md) — existing Determination/Decision state, adapter contract, and rules-engine-scope precedent (Decision 11)
- [Adapter Pattern](adapters.md)
- [Google CEL specification](https://github.com/google/cel-spec)
- [OMG DMN](https://www.omg.org/spec/DMN/)
- [Oracle Intelligent Advisor: Determinations Engine and the inference cycle](https://docs.oracle.com/html/E79061_01/Content/Introducing%20Oracle%20Policy%20Modeling/Deter_Engine_and_infer_cycle.htm)
- [Open Policy Agent](https://www.openpolicyagent.org/)
