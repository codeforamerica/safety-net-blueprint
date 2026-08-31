# Decision Rules DSL Design Notes

Observations from the Corticon translator spike that narrow down the decision rules DSL design. These feed into the formal design document ([`decision-rules-dsl.md`](../../docs/architecture/cross-cutting/decision-rules-dsl.md) on the `design/decision-rules-dsl` branch, tracked in issue [#386](https://github.com/codeforamerica/safety-net-blueprint/issues/386)).

The spike is not just a translation exercise — it is a design exercise. Every pattern the translator has to handle is a constraint on the DSL. What the DSL can express determines what the translator can produce.

---

## What is a "rules engine" in this context?

The blueprint has been cautious about claiming to include a rules engine. That caution was warranted for the wrong reason: the concern was about commercial, heavyweight engines (Drools, Corticon, IBM ODM) — complex products with their own IDEs, deployment models, and operational overhead. The blueprint correctly avoided mandating one of those.

But the mock server **already is a rules engine**. It interprets the behavioral contract DSL, evaluates CEL guard conditions, executes procedure steps, fires events, and enforces state machine transitions. That is exactly what a rules engine does. We built one. It is the reference implementation.

What the graph-based evaluation model adds on top of what the mock server already does:

| Already in mock server | Added by graph evaluation |
|---|---|
| CEL expression evaluation | Dependency graph resolution |
| Procedure step execution | Three-valued completeness propagation |
| Guard condition evaluation | Backward-chaining from goals |
| Event handling | Partial evaluation over incomplete data |

These are extensions to the existing interpreter, not a second product.

The principled answer to "does the blueprint include a rules engine?":

> **Yes — the mock server is the reference implementation of the evaluation engine.** It is not "out of scope"; it is what the mock server has always been. What states do with it varies: use the reference implementation directly, port it to their platform, or implement the DSL schema against an existing engine (Corticon, Drools, IBM Cúram). The blueprint does not mandate which, but it does provide a complete, working implementation as the reference. The graph-based evaluation model extends that existing implementation — it does not require building a new one from scratch.

### Why a dependency graph model at all?

The primary value is **partial evaluation**. A sequential evaluator hits the first unknown input and stops. A dependency graph evaluator can:

- Resolve everything that is determinable given the inputs provided
- Surface exactly which inputs are missing to resolve each unknown fact
- Tell the caller "here is what we know, here is what we still need and why"

This is the load-bearing reason for the graph model in a benefits context — applications arrive incomplete, case workers need to know what's blocking a determination, and self-service applicants need guidance on what to provide next. Everything else (declarative ordering, independent testability, overlay-friendly overrides) is real but secondary.

### What rules engines really buy you

The core value of a rules engine is **separating the "what" from the "how"**. Domain logic is a first-class, readable, independently maintainable artifact — policy changes do not require tracing through procedural code. Rules can be audited and tested in isolation.

This DSL is **developer-authored** for now. The format is optimized for developer readability and tooling integration, not for direct authoring by policy analysts. That is a deliberate scope decision, not a permanent one.

---

## Settled design decisions

### Expression language: CEL

CEL is the expression language for all fact expressions and conditions. Consistent with the rest of the blueprint (behavioral contract DSL, Decision 1) and with the decision-rules-dsl.md design (Decision 3). CEL handles everything Fact Graph's XML operator tree handles: arithmetic, comparison, conditionals, list operations.

No separate YAML structural constructs (`if:/then:/else:`, `match:`) are needed alongside CEL — CEL already has them (`condition ? then : else`, list comprehensions). Adding YAML constructs parallel to CEL's own syntax would proliferate complexity without benefit.

### Authoring format: YAML

The DSL is authored in YAML, consistent with the rest of the blueprint's behavioral artifacts (state machines, compositions, OpenAPI specs). TypeScript authoring would provide compile-time path validation via the type system, but YAML keeps the toolchain consistent and the format accessible.

### Two distinct path conventions

Two different things appear in expressions and they must be visually distinguishable:

**Data model reference (`$.entity.field`)** — addresses a field on an input entity. The `$.` prefix signals: this value comes from outside the graph, supplied by the caller. These are the leaf nodes — writable inputs.

**Graph path (`/domain/graph/factName`)** — names a fact node in the computation graph. The `/` prefix signals: this is a named computation declared in the rules file. Three segments: domain, graph name, fact name — modeled after IRS Fact Graph's own path convention (`/irs/f1040/line1`).

In a CEL expression, both appear together and are immediately distinguishable:

```yaml
- path: /intake/workRequirements/isABAWDExempt
  expression: "/intake/workRequirements/exemptionCategory != null"

- path: /intake/workRequirements/meetsWorkRequirement
  expression: "$.application.abawaWaiverActive || /intake/workRequirements/isABAWDExempt"
```

`$.application.abawaWaiverActive` — data model input, comes from the caller.
`/intake/workRequirements/isABAWDExempt` — another fact in this graph.

### Decomposition is structural, not optional

The `/path` reference convention forces decomposition. You cannot inline a graph path reference — you must declare the fact as a named node with its own `path:` and `expression:`. This prevents "one giant expression" — the graph structure is enforced by the syntax, not by convention.

### Dependencies are implicit

Dependencies between facts are inferred by the engine scanning `/` and `$.` references in each `expression:`. No explicit `depends:` field is needed. The engine builds the adjacency list from expressions, topologically sorts the graph, and evaluates in dependency order. Authors declare facts in any order — the engine resolves the sequence.

### Rules file owns all derived computation

The schema (OpenAPI) is the source of truth for **API structure**: field names, types, validation constraints. It is for API consumers.

The rules file is the source of truth for **computation**: which values derive from which, how completeness propagates, what the engine evaluates. It is for the rules engine.

These are separate concerns. The schema does not annotate fields with `x-derived:` — derivation logic lives entirely in the rules file. A field being derived is indicated by its presence in the rules file as a fact with an `expression:`, not by a schema annotation.

Writable inputs are implicit — any `$.entity.field` reference that has no corresponding fact in the rules file is an input the caller must supply.

### Type inference

Facts do not declare a `type:`. The engine infers types from CEL's type system combined with the types declared in the OpenAPI schema for `$.` references. CEL is strongly typed; expression types are fully determinable from operand types.

### Naming conventions

- **Domain:** camelCase (`intake`, `eligibility`) — matches blueprint domain names
- **Graph name:** camelCase (`workRequirements`, `snapEligibility`) — the goal name, becomes the RPC endpoint slug in kebab-case
- **Fact name:** camelCase (`isABAWDExempt`, `exemptionCategory`)
- **Endpoint path:** kebab-case (`/intake/applications/{applicationId}/assess-work-requirements`) — consistent with blueprint URL conventions

The graph name IS the goal. One graph = one invokable RPC endpoint. The graph name in camelCase translates to the endpoint slug in kebab-case, following the same convention as state machine action names to endpoint paths.

### Sink facts are the outputs

A **sink** is a fact that no other fact in the graph depends on — a root node with no dependents. Sinks are the graph's outputs. They are declared in `output:` to define which sinks are returned in the response. Any sink not listed in `output:` is an internal computation not surfaced to the caller.

---

## Universal rule graph intermediate format

The pipeline produces a **rule graph** as its canonical intermediate representation — the single artifact that sits between source translation (Corticon, rulespec, etc.) and output formatting (blueprint DSL, Fact Graph XML, FEEL/DMN, etc.). Any source translator produces a rule graph; any output formatter consumes one.

### Design decisions

**Self-describing without external refs.** The graph carries everything a formatter needs. Input node types use JSON Schema primitive type names (`"string"`, `"number"`, `"integer"`, `"boolean"`) inline — no `$ref` to an OpenAPI schema or any other external artifact. This keeps the format shareable outside the blueprint ecosystem.

**No top-level identity fields.** No `domain`, `graph`, or `id` at the file level. Identity is the consumer's concern — the blueprint populates those from its own conventions, another system uses whatever makes sense to it. The graph is purely the computation.

**Path conventions encode structure.** Two path prefixes distinguish node kinds:

- `$.path.to.value` — an input node. The `$.` prefix signals the value comes from the caller, not from the graph itself.
- `path.to.value` — a derived node. No prefix; the graph computes its value.

Collection traversal is encoded inline with `[]`:

```
$.application.members[].income   — input: income for each member (collection)
application.members[].isEligible — derived: eligibility for each member (collection)
application.isEligible           — derived: scalar on the root entity
```

The `[]` notation tells the engine that `members` is a collection and evaluation applies per-item. No external schema reference is needed to understand the shape.

**CEL for expressions; extensions declared explicitly.** Derived nodes carry a CEL expression string. Non-baseline functions (e.g. `yearsBetween`, `round`, `sum`) are listed in a top-level `functions` array so a formatter can check upfront whether it can handle every function the graph uses. The graph does not define function semantics — that is the translator's responsibility.

**`edgeId` for source tracing.** Edges carry an optional `edgeId` — a source-specific identifier (e.g. `file.ers:N` for Corticon, a derived-rule name for rulespec) that maps the edge back to the originating rule or formula. Format is source-specific; the field is for traceability, not for evaluation.

### Example

```json
{
  "functions": ["yearsBetween", "sum"],
  "nodes": {
    "$.application.members[].dob":      { "type": "string" },
    "$.application.members[].income":   { "type": "number" },
    "application.members[].age":        { "expression": "yearsBetween(dob, today())" },
    "application.members[].isEligible": { "expression": "age >= 18 && income < 1500" },
    "application.totalIncome":          { "expression": "$.application.members.map(m, m.income).sum()" },
    "application.isEligible":           { "expression": "application.members.all(m, m.isEligible)" }
  },
  "edges": [
    { "from": "$.application.members[].dob",    "to": "application.members[].age",        "edgeId": "age-calc.ers:1" },
    { "from": "$.application.members[].income", "to": "application.members[].isEligible", "edgeId": "eligibility.ers:2" },
    { "from": "application.members[].age",      "to": "application.members[].isEligible", "edgeId": "eligibility.ers:2" },
    { "from": "$.application.members[].income", "to": "application.totalIncome",          "edgeId": "totals.ers:1" },
    { "from": "application.members[].isEligible", "to": "application.isEligible",         "edgeId": "eligibility.ers:3" }
  ]
}
```

---

## DSL file structure

One file per graph. The graph name is the goal. Example:

```yaml
$schema: "./schemas/decision-rules-schema.yaml"
version: "1.0"
domain: intake
graph: workRequirements

endpoint:
  path: /intake/applications/{applicationId}/assess-work-requirements

input:
  application:
    $ref: '#/components/schemas/Application'
  applicationMember:
    $ref: '#/components/schemas/ApplicationMember'
  workActivities:
    type: array
    items:
      $ref: '#/components/schemas/WorkActivity'

output:
  - /intake/workRequirements/meetsWorkRequirement
  - /intake/workRequirements/exemptionCategory

facts:
  - path: /intake/workRequirements/exemptionCategory
    expression: "($.applicationMember.hasDisability) ? 'disability' : ($.applicationMember.isPregnant) ? 'pregnancy' : ($.applicationMember.hasChildUnder6) ? 'caretaker' : null"

  - path: /intake/workRequirements/isABAWDExempt
    expression: "/intake/workRequirements/exemptionCategory != null"

  - path: /intake/workRequirements/isInABAWDAge
    expression: "($.applicationMember.age >= 18 && $.applicationMember.age <= 51)"

  - path: /intake/workRequirements/meetsWorkRequirement
    expression: "$.application.abawaWaiverActive || /intake/workRequirements/isABAWDExempt"
```

**Top-level keys:**

- `domain:` — the blueprint domain this graph belongs to (camelCase)
- `graph:` — the goal name; drives the endpoint slug and the path prefix for all facts in this file (camelCase)
- `endpoint:` — the RPC endpoint this graph is invoked at; always POST (omit `method:`)
- `input:` — the request body contract; declares which entities the engine needs to evaluate this graph, using `$ref` to OpenAPI schemas; supports singletons and arrays
- `output:` — the facts returned in the response; list of graph paths; the last path segment becomes the response field name
- `facts:` — the computation graph; each fact has a `path:` (its address in the graph) and an `expression:` (CEL)

**Response shape:**

The engine always returns both resolved output values and a `missing:` block listing which input fields are needed to resolve any unknowns — the partial evaluation contract.

---

## Fact vs. data model — the key distinction

The data model (OpenAPI/JSON Schema) defines **API structure**: what resources exist, what fields they have, what their types and validation rules are. It is for API consumers.

The decision rules DSL defines **computation**: which values derive from which, how completeness propagates, what the engine evaluates. It is for the rules engine.

**Entity creation and orchestration are not in this DSL.** When a Corticon rule creates a new entity, that is a side effect — an orchestration concern. The *computation* ("these members belong in the same household") is a derived fact. The *action* of creating the record is a state machine effect that fires after the engine returns that outcome. The rules DSL is purely functional: facts in, derived values out, no side effects.

---

## Structural model: consistent with IRS Fact Graph

The substitution table from IRS Fact Graph to this DSL:

| IRS Fact Graph | This DSL |
|---|---|
| XML path identifier (`/irs/f1040/line1`) | Graph path (`/domain/graph/factName`) |
| XML operator tree (`<Sum>`, `<If>`, `<Ref>`) | CEL string |
| `<Ref path="..."/>` node | `$.field` (data model) or `/path` (graph fact) in CEL |
| `module="..."` attribute | First two segments of the graph path (`/domain/graph/`) |
| `<Writable>` | `$.entity.field` reference with no corresponding fact — implicit input |
| `<Derived>` | Fact with an `expression:` in the rules file |
| Three-valued completeness | Same — resolved / unresolved / missing |

---

## Unification: one evaluation model for the whole behavioral layer

The strongest convergence point between the decision rules DSL and the behavioral contract DSL is **procedure evaluation logic**. A state machine procedure currently expresses what happens as a sequential step list. But what a procedure actually does is: given the current state of the world, derive a set of effects. That is a computation — expressible as a dependency graph using the same evaluation model as the decision rules DSL.

In this model, effects are derived facts. Instead of a step list:

```yaml
# Current: imperative step list
steps:
  - if: '"snap" in $.object.programs'
    then:
      - call: {POST: /intake/applications/$.object.id/verifications, body: {program: snap}}
  - emit: {type: intake.application.submitted}
```

Procedure logic becomes a graph of derived effects:

```yaml
# Proposed: derived effects
- path: /effects/createSnapVerification
  expression: '"snap" in $.object.programs'
  effect: {call: {POST: /intake/applications/$.object.id/verifications, body: {program: snap}}}

- path: /effects/emitSubmitted
  expression: "true"
  effect: {emit: {type: intake.application.submitted}}
```

The engine evaluates the graph, resolves which effects are true, and executes them. The evaluation model — CEL expressions, dependency graph, completeness propagation — is identical to the decision rules model. The only difference is output type: values vs. effects.

This means **one engine across the whole behavioral layer**. The mock server's existing interpreter is extended with graph evaluation, not replaced. Conventions converge over time; existing state machine contracts do not need to be rewritten.

### Advantages

- **One engine** — the same evaluation model handles eligibility computation and workflow logic. One interpreter to build, maintain, and explain.
- **Declarative** — you define what effects should occur given certain conditions, not the sequence of operations. Easier to reason about, test, and audit.
- **Parallelization** — independent effects have no ordering dependency. The engine can execute them concurrently by default.
- **Partial evaluation everywhere** — the completeness model applies to procedure logic. "What effects would fire if we knew all inputs" is evaluable before a case is complete — useful for pre-flight checks and impact assessment.
- **Overlay-friendly** — overriding a derived effect is adding or replacing a node in the graph. In a step list you need to know where to insert.
- **Traceable** — the dependency graph makes explicit what inputs caused what effects. Auditing is reading the trace, not replaying a sequence.
- **Consistent conventions** — path notation, CEL expressions, and dependency structure are the same everywhere in the behavioral layer.

### Disadvantages and mitigations

**Sequential side effects are awkward to express.**
When operations have inherent ordering (create parent record before child, start timer before subscribing to callback), graph-based evaluation requires explicit dependency edges rather than implied positional order.
*Mitigation:* Effects declare explicit `requires:` dependencies on other effects when ordering matters. `effectB` with `requires: [/effects/effectA]` is unambiguous and more explicit about the actual constraint than positional ordering, which silently encodes ordering as a side effect of list position.

**Error handling and compensation are non-trivial.**
Step-based models have natural try/catch and rollback patterns. In a graph with side effects, partial failure — some effects executed, some not — requires explicit modeling.
*Mitigation:* Effects are typed with retry and rollback behaviors declared as properties of the effect node, not as separate steps. Compensation logic is itself a derived effect: `/effects/compensateVerification` derives to true when `/effects/createVerification` has `status: failed`. The engine tracks effect execution state as facts, making compensation a first-class graph concern rather than an afterthought.

**Mental model shift.**
Most developers think imperatively. Sequential steps are intuitive; graph-based evaluation requires a different mode of thinking.
*Mitigation:* Guards in the existing state machine DSL are already derived boolean facts evaluated against the current state. The shift is extending a familiar concept to procedures, not introducing a foreign one. The graph visualizer being built in this spike makes the model navigable without requiring developers to mentally simulate dependency resolution. Good tooling solves the discoverability problem.

**Migration cost.**
The behavioral contract DSL is already implemented, used, and understood. Refactoring it is real work with real risk.
*Mitigation:* This is a conventions convergence, not a rewrite. New procedures use graph-based evaluation; existing procedures continue working through the current step executor. The mock server adds graph evaluation as a parallel execution path, not a replacement. Migration happens incrementally as procedures are authored or updated, not as a flag-day cutover.

**Simple sequential procedures become overengineered.**
Sometimes three API calls genuinely need to run in order with no conditional logic. A graph for that is unnecessary complexity.
*Mitigation:* A sequential graph where each effect declares `requires:` on the previous one is equivalent to a step list, just more explicit about its ordering constraints. The authoring experience can provide a shorthand for linear chains. Alternatively, the step executor is retained as a valid authoring style for purely sequential, unconditional procedures — graph evaluation is the model for procedures with conditional logic, not a mandate for all procedures regardless of complexity.

---

## Open questions

### Invocation model

How graphs are invoked beyond the basic RPC endpoint — whether compositions can declare which graphs feed into a view, and how the engine is called from the composition runtime. The goal is something similar to how compositions declare resources, but for decision graph evaluation.

### State machine integration

How much reuse and unification makes sense between the decision rules DSL and the state machine behavioral contract DSL. The unification model above is the target direction; the extent and sequencing of that convergence is not yet decided.

### Platform and domain-level configuration

Rule graphs reference policy parameters by path (`$.policy.expedited_income_threshold`). The default values for those parameters should not be declared inside individual rule graphs — they belong to the blueprint's own configuration layer, which is the source of truth for platform-level policy values. States override them through the existing overlay mechanism.

This separates two concerns that should not be coupled:

- **What the rule uses** — declared in the rule graph by path reference. The graph is policy-neutral; it does not own the values.
- **What the value is** — declared at the platform level (blueprint) or state level (overlay). Policy changes do not require touching rule graphs.

Three tiers of configuration, coarsest to finest:

| Tier | Scope | Who sets it | Example |
|---|---|---|---|
| Platform | All states using the blueprint | Blueprint maintainers | Expedited SNAP income threshold ($150) |
| Domain | A program domain across a state's instance | State policy team | State-specific ABAWD waiver status |
| Case | A specific case or household | Runtime data | Household size, reported income |

Case-level values are runtime inputs, not configuration. Platform and domain values are configuration — they change at policy update cadence, not per-request. The blueprint needs a strategy for where platform and domain configuration is declared and how it flows into rule evaluation. This is not yet settled but the direction is: blueprint provides a parameter namespace (`$.policy.*`, `$.config.*`, or similar) with defaults declared in a blueprint-owned config artifact (YAML, consistent with other blueprint artifacts), and states override via overlays.

### Placeholder / default values

Some Corticon facts have defaults that are themselves CEL expressions (e.g. a field defaulting to another field's value when null). JSON Schema `default:` only supports static values. How the DSL expresses dynamic defaults — whether as a separate `default:` key on a fact, a sentinel function, or something else — is not yet decided.

### Completeness model for effects

Whether three-valued completeness (known/unknown/missing) applies to derived effects the same way it applies to derived values. If an effect's condition cannot be determined because some inputs are unknown, the effect is "not yet determinable" — useful for pre-flight checks but requires the engine to surface this state to the caller in a useful way.
