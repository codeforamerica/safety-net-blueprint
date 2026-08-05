# Translation patterns

This spike's actual job (issue [#388](https://github.com/codeforamerica/safety-net-blueprint/issues/388)) is to translate a real forward-chaining Corticon ruleset into the reverse-chaining, dependency-graph-based decision-rules DSL (see [`FORWARD-VS-REVERSE-CHAINING.md`](./FORWARD-VS-REVERSE-CHAINING.md) and [`DEPENDENCY-GRAPH-GLOSSARY.md`](./DEPENDENCY-GRAPH-GLOSSARY.md)). These aren't concepts either engine has natively — they're patterns that only exist *because* one model is being converted into the other, and each one needs to be recognized and handled correctly rather than translated literally.

This isn't a fixed, closed catalog written once before implementation started. New real patterns kept surfacing purely from the process of building the translator — operator precedence, decision-table hit-policy semantics, sequence-indexing base, cross-rulesheet invocation order — none of which were anticipated before implementation forced the question. Identifying new translation patterns as real data is encountered is an ongoing goal of this spike in its own right, not just a byproduct of it.

**The machine-readable catalog** — pattern names, translation approach, external dependencies, and status — lives in [`translation-patterns.yaml`](./translation-patterns.yaml). This document provides the evidence and reasoning behind each entry in that file.

---

## Translates directly

**`decision-table`** — Corticon's default hit policy is UNIQUE: rows are required to be mutually exclusive, enforced by Corticon Studio's own conflict checker at design time. Row order is therefore safe to compile arbitrarily in the default case. When two rows genuinely can both match, the rule author sets explicit priority via `overrides`/`overriddenBy` attributes — see `explicit-override`. Condition columns are AND-ed across columns, but each individual column's own text must be parenthesized before joining, because a single column can contain an internal `or` (e.g. `Person.isInmate = F or Person.isInmate = null`) that would bind incorrectly against a bare `&&`. Confirmed by DC Medicaid/CHIP's `MAGI Eligibility Groups.ers` (17 real rows) and `Income Requirements.ers` (the AND-parenthesization issue found as a real bug).

**`explicit-override`** — When two rows in a rulesheet genuinely can both match, the author sets explicit priority via `overrides`/`overriddenBy` EMF ref-list attributes. Corticon has no DMN-style rulesheet-level hit-policy setting; override is the only conflict-resolution mechanism. The common pattern is an unconditional fallback row (always fires) paired with a conditional row that overrides it when its condition holds — equivalent to an if/else. Confirmed in `fixtures/irr/evaluate npv.ers` and DC Medicaid/CHIP's `Citizenship requirements.ers`.

**`fact-assembly`** — Multiple rulesheets each write part of the same fact under different conditions. Resolution order follows ruleflow node position, not discovery order. Confirmed by DC Medicaid/CHIP's `Parse Cohorts.ers` + `Flatten.ers` jointly determining `Person.MedicaidEligible`; resolution-order rule confirmed by Progress's own documentation.

**`conditional-branching`** — A `BranchContainer` node routes execution to one or more target rulesheets based on a condition, then rejoins the main flow. Only the matching branch's targets execute; when no branch matches, execution skips all targets and continues from the convergence point. Targets within a single branch can chain sequentially. Confirmed shape from third-party Corticon projects (`HOUDAAHMAD` insurance-rating).

**`enum-switch-branching`** — A `BranchContainer` dispatches on an enumerated attribute value, routing to a different target rulesheet per enum value. Structurally identical to `conditional-branching` — same `BranchContainer` XML shape — but the condition expression is an enum identity test rather than an arbitrary boolean. Distinguishable by the `enumeration="true"` flag on the `parserOutput` element.

**`null-default`** — A rule checks whether a value is null and assigns a placeholder if so. Structurally this reads and writes the same field, producing a self-loop in the dependency graph, but semantically it is a default fill-in — the target DSL has a native Placeholder construct for this rather than translating it as a real cycle. Confirmed by `Mortgage/Regular_NoData.ers` real captured trace.

**`no-op`** — A rule has conditions but no actions. It evaluates conditions but produces no writes and therefore no Fact derivations. In Corticon Studio, the first visible rule column in a decision table is sometimes used this way — as a documentation or label column describing what each condition row tests. Regardless of intent, a no-op rule is excluded from fact compilation. Confirmed real in DC Medicaid/CHIP's `MAGI Eligibility Groups.ers` (rule[12]: conditions present, all actions absent).

**`unreachable-rulesheet`** — A rulesheet never invoked by any ruleflow contributes nothing to the output, but its writes must be explicitly excluded from fact compilation — not just flagged as unreachable. An unreachable rulesheet can write the same field as a live one, and silently including it in fact compilation produces a real wrong answer. Confirmed by DC Medicaid/CHIP's `Non-MAGI Eligibility Groups.ers`, which writes `Person.outputCoverage1` — the same path written by the live `Flatten.ers`.

**`operator-precedence`** — Corticon's precedence order is: unary (`-`, `not`) > multiplicative (`*`, `/`, `**`) > additive (`+`, `-`) > relational > logical (`and`, `or`), left-associative. `**` (exponentiation) is the same tier as `*`/`/`, not higher as in most general-purpose languages. `<>` is Corticon's not-equal operator. Confirmed by Progress's own "Operator precedence and order of evaluation" documentation.

**`logical-keywords`** — `and`, `or`, and `not` are real Corticon keywords. Confirmed by Progress's own "Operator precedence and order of evaluation" documentation. All three appear in synthetic fixture `logical-operators.ers`.

**`range-membership`** — `X in (lower..upper]` with independently optional brackets; an omitted bracket means inclusive. Confirmed by DC Medicaid/CHIP's own `Person.age in ( 18 .. 26 )`, `Person.HouseholdActualPercentFPL in ( 220 .. 250 ]`, and `Person.age in 21 .. 64`.

---

## Requires caller contract

**`entity-creation`** — A rulesheet creates new entity instances with `.newUnique[...]` or `.new`, and associates them to existing entities via collection-append (`members += Person`). The graph receives fully-formed entities as inputs; entity assembly is a caller responsibility. Which entities and fields are required is derivable from the Corticon actions on the specific rule. Confirmed by DC Medicaid/CHIP's real `Household.newUnique[...]` and `members += Person` actions.

**`iterative-convergence`** — A ruleflow step marked `iterative` re-runs its rulesheet repeatedly until no fact changes in a pass. The loop terminates at fixpoint, not after a fixed count. The caller runs the iteration externally and passes the converged value as a graph input. An `iterative` flag on a step whose rulesheet doesn't actually change any fact is equivalent to a non-iterative step (it converges in one pass), but the ruleflow XML still marks it `iterative`. Confirmed by IRR's real captured trace.

**`service-callout`** — A ruleflow connector node calls external JavaScript with read/write access to the entire fact pool. There is no declared input/output mapping — the connector is fully opaque to static analysis. The service result is injected as a graph input by the caller. Which values the service provides is not resolvable from the ruleflow XML — only from the connector's own external JS class. Confirmed shape from `corticon.js-samples/ServiceCallOut`; access semantics confirmed by Progress's own ["Introduction: Service Call-out (Corticon.js v2.0)"](https://www.progress.com/blogs/introduction-service-call-out-corticon.js-v2.0) documentation.

---

## Requires DSL function

**`date-arithmetic`** — Corticon has real date operators: `yearsBetween`, `addYears`, and counterparts for months/days. Which function is needed is derivable from the Corticon action on the specific rule. Confirmed by DC Medicaid/CHIP's own `Person.dob.yearsBetween(today)`.

**`decimal-rounding`** — The `.round(n)` operator rounds a decimal to `n` places. Confirmed by DC Medicaid/CHIP's own `.round(2)` usage.

**`sort-ranking`** — `->sortedBy` sorts a collection ascending; `->sortedByDesc` sorts descending. Confirmed by Progress's own documentation.

**`type-conversion`** — `.toString()` converts a non-string value to its string representation; the same method family (`.toDecimal`, `.toDate`, `.toTime`, `.toInteger`) applies per data type. `.toString()` confirmed by DC Medicaid/CHIP's real use with a captured `.ert` trace. Broader operators are documented by Progress but have no fixture yet.

---

## Partially translated

**`collection-filter`** — A rulesheet's filter gates every rule in that scope. The filter condition is folded into every Fact this rulesheet compiles as a guard. Confirmed by DC Medicaid/CHIP's `Parse Cohorts.ers`, which has a real filter (`cohorts->notEmpty`) and a rule (`Person.MedicaidEligible = T`) that doesn't reference `cohorts` at all but is still gated by it. Open question: the full-vs-limiting cascade behavior (does an empty-after-filter collection exclude the whole parent entity, not just this alias?) is not resolvable from static file inspection.

---

## Unverified

**`sort-ranking-index`** — `->at(n)` index access into a sorted collection is 1-based, not 0-based. Found in two independent real Corticon projects (`corticon-classic-samples` "Ranking and Ordering", `Seth-Meldon/criticality` "Health Risk") with no counter-example, but no populated captured trace was located.

**`universal-quantifier`** — `->forAll(predicate)` returns true only if every element of a collection satisfies the predicate. Documented at [docs.progress.com's "For all" page](https://docs.progress.com/bundle/corticon-js-rule-language/page/For-all.html). CEL's native `.all(x, predicate)` macro is the likely mapping but is unconfirmed.

---

## Unknown

**`double-quoted-strings`** — Whether Corticon accepts double-quoted string literals alongside single-quoted is unresolved — no real example or documentation found confirming or ruling it out.

---

## Semantic classification

Naive dependency-graph translation gets the wrong answer when the same graph shape can mean different things. The patterns section above covers what each construct *is*; this section explains why recognizing them correctly requires more than reading the graph edges.

### The three-way self-loop ambiguity

A dependency-graph self-loop (a value that depends on itself) is structurally identical no matter why it exists — but the same raw shape shows up for three completely different real reasons:

1. **Iterative convergence** — a real "keep adjusting until it converges" calculation. The caller runs this externally.
2. **Decision-table alternative row** — a rule table has multiple mutually-exclusive rows, and one row's condition happens to check the same field another row sets. Nothing is repeated; the graph edge is an artifact of representation.
3. **Null default** — a rule checks "is this still unknown?" and assigns a placeholder. The target DSL has a native Placeholder construct for this.

Telling these apart requires the specific rule's condition text (does it check for null?) and whether it is ever reached from inside an `iterative` ruleflow step — which requires resolving invocation context first.

### Fact assembly

A single value can be decided by several separate rulesheets, each contributing part of the answer under different conditions. The target DSL has no equivalent: a Derived fact has exactly one expression. Translating each rulesheet in isolation produces conflicting or incomplete facts. The combined logic must be recognized and merged into a single correct expression.

### Invocation context

Whether a rulesheet is "inside a loop" or "inside a branch" depends entirely on how the ruleflow invokes it — nothing in the rulesheet file itself says so. Working this out requires walking the full ruleflow graph, including nested ruleflows, from each entry point.

---

## Translator implementation

### What ingestion deliberately excludes

Phase 1 ingestion (`src/corticon/`) is meant to be faithful — no rule, condition, action, or human-authored documentation silently dropped. That standard was checked directly, not assumed: every real leaf value in a rulesheet's raw parsed XML was diffed against `parseRulesheet`'s own extracted output for DC Medicaid/CHIP's `MAGI Eligibility Groups.ers`. Two real gaps that check found are now fixed and covered by tests: Corticon Studio's own reserved blank/template row (previously filtered out, silently shifting every later rule's index away from Corticon's own numbering) and per-rule `documentingRuleStatements`/`ruleStatement` business-readable comments (previously dropped entirely).

What's still deliberately excluded, confirmed as presentation/plumbing rather than real rule content — not assumed unimportant, checked:

**Grid-cell display shorthand** (`viewExpressions`, `actionValueSetCellList`). Corticon Studio's compact display format — `{19, 20}` for `Person.age = 19 or Person.age = 20` — with the full expression already captured in `parserOutput.text`.

**UI layout metadata** (`rowHeight`, `columnWidth`, `sashWeight*`, `scrollRowTop`, `rowCount`/`columnCount`). Grid rendering hints — pure numbers with no rule-semantic content.

**EMF internal cross-references** (`#//@ruleset/@rules.N`, etc.). Structural plumbing for resolving links within the same XML document; the information those links carry is already captured by array position or by `refIndex()`'s own explicit resolution.

**Rulesheet-scope vocabulary declarations** (`<referencedAttributes attribute="..."/>`). Corticon Studio's column-picker bookkeeping — redundant with `vocab.ecore`'s own attribute definitions and with each actually-used term's own `datatype`.

**Pure XMI/EMF asset metadata** (`buildNumber`, `updateStamp`, `externalChecksum`, `studioType`, namespace URIs). Asset versioning and structural type-tagging, not rule content.

Column-level metadata (`rulesheetViewList`'s `actionItemList`/`conditionItemList`, including real human-authored `naturalLanguageText` descriptions) is the one exception captured without a fully understood use yet — see `rulesheet.js`'s own comment on `extractColumnDefinitions` and issue #388's Phase 5 plan.

### Fail loudly, not silently

**Silent mistranslation risk.** A mechanical translator can produce plausible-looking but wrong CEL for a construct it doesn't actually understand. Every translation stage is scoped to only the constructs confirmed real across this spike's fixtures, and throws a specific, actionable error on anything outside that set rather than guessing.

**Silent content-drop risk.** A hand-written extractor can silently drop real source content simply because nobody anticipated needing it. To catch this: diff every leaf value recursively collected from the raw parsed source against every leaf value in the transformed output. This is how the reserved blank/template row and per-rule `ruleStatement` documentation were found.
