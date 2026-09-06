# Translation patterns

This spike's actual job (issue [#388](https://github.com/codeforamerica/safety-net-blueprint/issues/388)) is to translate a real forward-chaining Corticon ruleset into the reverse-chaining, dependency-graph-based decision-rules DSL (see [`FORWARD-VS-REVERSE-CHAINING.md`](./FORWARD-VS-REVERSE-CHAINING.md) and [`DEPENDENCY-GRAPH-GLOSSARY.md`](./DEPENDENCY-GRAPH-GLOSSARY.md)). These aren't concepts either engine has natively — they're patterns that only exist *because* one model is being converted into the other, and each one needs to be recognized and handled correctly rather than translated literally.

This isn't a fixed, closed catalog written once before implementation started. New real patterns kept surfacing purely from the process of building the translator — operator precedence, decision-table hit-policy semantics, sequence-indexing base, cross-rulesheet invocation order — none of which were anticipated before implementation forced the question. Identifying new translation patterns as real data is encountered is an ongoing goal of this spike in its own right, not just a byproduct of it.

**The machine-readable catalog** lives in [`src/translation-patterns.yaml`](../src/translation-patterns.yaml). This document provides the evidence and reasoning behind each entry in that file.

---

## Translates directly

**`decision-table`** — Corticon's default hit policy is UNIQUE: rows are required to be mutually exclusive, enforced by Corticon Studio's own conflict checker at design time. Row order is therefore safe to compile arbitrarily in the default case. When two rows genuinely can both match, the rule author sets explicit priority via `overrides`/`overriddenBy` attributes — see `explicit-override`. Condition columns are AND-ed across columns, but each individual column's own text must be parenthesized before joining, because a single column can contain an internal `or` (e.g. `Person.isInmate = F or Person.isInmate = null`) that would bind incorrectly against a bare `&&`. Confirmed by DC Medicaid/CHIP's `MAGI Eligibility Groups.ers` (17 real rows) and `Income Requirements.ers` (the AND-parenthesization issue found as a real bug).

**`explicit-override`** — When two rows in a rulesheet genuinely can both match, the author sets explicit priority via `overrides`/`overriddenBy` EMF ref-list attributes. Corticon has no DMN-style rulesheet-level hit-policy setting; override is the only conflict-resolution mechanism. The common pattern is an unconditional fallback row (always fires) paired with a conditional row that overrides it when its condition holds — equivalent to an if/else. Confirmed in `fixtures/corticon/vendor-samples/irr/evaluate npv.ers` and DC Medicaid/CHIP's `Citizenship requirements.ers`.

**`fact-assembly`** — Multiple rulesheets each write part of the same fact under different conditions. Resolution order follows ruleflow node position, not discovery order. Confirmed by DC Medicaid/CHIP's `Parse Cohorts.ers` + `Flatten.ers` jointly determining `Person.MedicaidEligible`; resolution-order rule confirmed by Progress's own documentation.

**`conditional-branching`** — A `BranchContainer` node routes execution to one or more target rulesheets based on a condition, then rejoins the main flow. Only the matching branch's targets execute; when no branch matches, execution skips all targets and continues from the convergence point. Targets within a single branch can chain sequentially. Confirmed shape from third-party Corticon projects (`HOUDAAHMAD` insurance-rating).

**`enum-switch-branching`** — A `BranchContainer` dispatches on an enumerated attribute value, routing to a different target rulesheet per enum value. Structurally identical to `conditional-branching` — same `BranchContainer` XML shape — but the condition expression is an enum identity test rather than an arbitrary boolean. Distinguishable by the `enumeration="true"` flag on the `parserOutput` element.

**`null-default`** — A rule checks whether a value is null and assigns a placeholder if so. Structurally this reads and writes the same field, producing a self-loop in the dependency graph, but semantically it is a default fill-in — the target DSL has a native Placeholder construct for this rather than translating it as a real cycle. Confirmed by `Mortgage/Regular_NoData.ers` real captured trace.

**`no-op`** — A rule has conditions but no actions. It evaluates conditions but produces no writes and therefore no Fact derivations. In Corticon Studio, the first visible rule column in a decision table is sometimes used this way — as a documentation or label column describing what each condition row tests. Regardless of intent, a no-op rule is excluded from fact compilation. Confirmed real in DC Medicaid/CHIP's `MAGI Eligibility Groups.ers` (rule[12]: conditions present, all actions absent).

**`unreachable`** — A rulesheet never invoked by any ruleflow contributes nothing to the output, but its writes must be explicitly excluded from fact compilation — not just flagged as unreachable. An unreachable rulesheet can write the same field as a live one, and silently including it in fact compilation produces a real wrong answer. Confirmed by DC Medicaid/CHIP's `Non-MAGI Eligibility Groups.ers`, which writes `Person.outputCoverage1` — the same path written by the live `Flatten.ers`.

**`operator-precedence`** — Corticon's precedence order is: unary (`-`, `not`) > multiplicative (`*`, `/`, `**`) > additive (`+`, `-`) > relational > logical (`and`, `or`), left-associative. `**` (exponentiation) is the same tier as `*`/`/`, not higher as in most general-purpose languages. `<>` is Corticon's not-equal operator. Confirmed by Progress's own "Operator precedence and order of evaluation" documentation.

**`logical-keywords`** — `and`, `or`, and `not` are real Corticon keywords. Confirmed by Progress's own "Operator precedence and order of evaluation" documentation. All three appear in synthetic fixture `logical-operators.ers`.

**`decision-table-alternative-row`** — A decision-table row whose condition reads the same attribute another row in the same rulesheet writes. Corticon's UNIQUE hit policy guarantees the rows are mutually exclusive — only one fires per fact pass — so this is not a real cycle. The dependency-graph self-loop it creates is an artifact of representing multiple mutually-exclusive rows as a single graph node; the rows compile as an ordinary if/else chain with no special handling. Confirmed real in DC Medicaid's `Flatten.ers`, which checks `Person.outputCoverage1.contains('ineligible')` in one row while a separate row sets `Person.outputCoverage1`.

**`membership-test`** — Test whether a value belongs to a set. How the set is expressed determines the translation approach; two confirmed variants:

- **`range`** — `X in (lower..upper]` with independently optional brackets; an omitted bracket means inclusive. Confirmed by DC Medicaid/CHIP's own `Person.age in ( 18 .. 26 )`, `Person.HouseholdActualPercentFPL in ( 220 .. 250 ]`, and `Person.age in 21 .. 64`.
- **`string-list`** — A `String` attribute holds a delimited list of tokens; the Corticon `.contains()` string operator tests whether a given value appears in that list. The semantics (substring match vs. delimiter-separated token match) are not determinable from static file inspection — see `ambiguous` section below. Confirmed shape from CBMS Disaster FS: `snapDisaster.cntyCdList.contains(snapHhDstrDetails.homeCntyCd)`, `snapDisaster.zipList.contains(snapHhDstrDetails.homeZip)`, `snapHhDstrDetails.actvIndvList.contains(client.clientID.toInteger.toString)`.

---

## Requires caller contract

**`constructor`** — A rulesheet creates new entity instances or mutates associations. Two variants based on whether the created association is subsequently read by other rules:

- **`constructor-input`** — The association is written AND subsequently read downstream. The graph receives it as a caller-supplied input: the caller pre-assembles entity instances before invoking the graph. The `.newUnique[key-fields]` / `.new[...]` distinction shifts idempotency responsibility — newUnique means the caller can safely call twice; new means a fresh instance every time. Association mutation (`members += Person`) without a NEW term is also caller-contract. Confirmed by DC Medicaid/CHIP's real `Household.newUnique[...]`, `Cohort.new[...]`, and `members += Person` actions.
- **`constructor-output`** — The association is only written, never read by any downstream rule. The collection should appear in the response body; the DSL derives its contents from the creation logic — the conditions that gate entity creation become the expression guard, and the assigned fields on the new entity become the output shape. Confirmed real in SNAP work requirements' `ApplicationMember.exemptions` (`WorkExemption.exemptionType` is assigned based on `exemptionCategory`, never referenced elsewhere). The DSL expression approach for collection outputs is not yet settled.

**`fixpoint`** — A ruleflow step marked `iterative` re-runs its rulesheet repeatedly until no fact changes in a pass. The loop terminates at fixpoint, not after a fixed count. The caller runs the iteration externally and passes the converged value as a graph input. An `iterative` flag on a step whose rulesheet doesn't actually change any fact is equivalent to a non-iterative step (it converges in one pass), but the ruleflow XML still marks it `iterative`. Confirmed by IRR's real captured trace.

**`call-procedure`** — A ruleflow connector node calls external JavaScript with read/write access to the entire fact pool. There is no declared input/output mapping — the connector is fully opaque to static analysis. The service result is injected as a graph input by the caller. Which values the service provides is not resolvable from the ruleflow XML — only from the connector's own external JS class. Confirmed shape from `corticon.js-samples/ServiceCallOut`; access semantics confirmed by Progress's own ["Introduction: Service Call-out (Corticon.js v2.0)"](https://www.progress.com/blogs/introduction-service-call-out-corticon.js-v2.0) documentation.

- **`deterministic-extension`** — A Java extension method called from within a rule expression (e.g. `Allotment.getMaximumAllotmentAmount(...)`) that is a pure function — no I/O, no external state, deterministic output for the same inputs. Translates to a DSL function rather than a caller-contract injection. Distinguishable from the opaque variant by examining the Java source: if the class does not call `ReferenceTableFieldFinder` or any external resource, it is a deterministic extension. In CBMS Disaster FS: `EligUtility.getLastMonth(yyyymm)`, `getNextMonth(yyyymm)`, `getBusinessDays(date, n)`, `calcPOIDate(...)`. Not confirmed against an executed trace yet.

---

## Requires DSL function

**`date-arithmetic`** — Corticon has real date operators: `yearsBetween`, `addYears`, and counterparts for months/days. Which function is needed is derivable from the Corticon action on the specific rule. Confirmed by DC Medicaid/CHIP's own `Person.dob.yearsBetween(today)` and CBMS Disaster FS's own `participatingProgramIndvEligRslt.prmAidCdBgnDt.monthsBetween(program.runDate)`.

**`decimal-rounding`** — The `.round(n)` operator rounds a decimal to `n` places. Confirmed by DC Medicaid/CHIP's own `.round(2)` usage.

**`sort-ranking`** — `->sortedBy` sorts a collection ascending; `->sortedByDesc` sorts descending. Confirmed by Progress's own documentation.

**`type-conversion`** — `.toString()` converts a non-string value to its string representation; the same method family (`.toDecimal`, `.toDate`, `.toTime`, `.toInteger`) applies per data type. `.toString()` confirmed by DC Medicaid/CHIP's real use with a captured `.ert` trace. Broader operators are documented by Progress but have no fixture yet.

---

## Partially translated

**`guard`** — A rulesheet's filter gates every rule in that scope. The filter condition is folded into every Fact this rulesheet compiles as a guard. Confirmed by DC Medicaid/CHIP's `Parse Cohorts.ers`, which has a real filter (`cohorts->notEmpty`) and a rule (`Person.MedicaidEligible = T`) that doesn't reference `cohorts` at all but is still gated by it. Open question: the full-vs-limiting cascade behavior (does an empty-after-filter collection exclude the whole parent entity, not just this alias?) is not resolvable from static file inspection.

---

## Unverified

**`sort-ranking-index`** — `->at(n)` index access into a sorted collection is 1-based, not 0-based. Found in two independent real Corticon projects (`corticon-classic-samples` "Ranking and Ordering", `Seth-Meldon/criticality` "Health Risk") with no counter-example, but no populated captured trace was located.

**`universal-quantifier`** — `->forAll(predicate)` returns true only if every element of a collection satisfies the predicate. Documented at [docs.progress.com's "For all" page](https://docs.progress.com/bundle/corticon-js-rule-language/page/For-all.html). CEL's native `.all(x, predicate)` macro is the likely mapping but is unconfirmed.

**`scalar-accumulator`** — A rule uses `+=` on a scalar attribute (e.g. `program.t_totalNoOfClients += 1`) to accumulate a count across multiple entity-scoped firings. In Corticon's forward-chaining model this fires once per matching entity instance and increments the counter each time. The dependency graph has no equivalent of multi-firing accumulation: the correct translation is almost always a collection aggregate (`->size` or a filtered count) on the implied entity collection, but which collection and which filter is not determinable from static analysis of the rulesheet alone — it requires tracing all rules that participate in populating that collection. Confirmed by CBMS Disaster FS's `program.t_totalNoOfClients += 1`. Requires manual confirmation of what is being counted before translating.

**`extension-call`** — A Java extension method call detected in the rule expression (e.g. `EligUtility.getLastMonth(yyyymm)`, `ReferenceTableData.getDecimalValue(...)`). The translator emits a `__ext_ClassName_method(args)` placeholder rather than crashing so the pipeline can complete and the translation log can flag the call. Whether the extension is a deterministic pure function (maps to `call-procedure/deterministic-extension`, requires a DSL function) or an external-state lookup (maps to `call-procedure`, requires caller-contract) cannot be determined from the rulesheet alone — it requires examining the Java source to see whether the class calls `ReferenceTableFieldFinder` or any external resource. Confirmed shape from CBMS Disaster FS. Requires manual review before translating.

---

## Diagnostic / Cannot translate automatically

These are not Corticon constructs with translation approaches — they are classifier findings that block automatic translation. They appear as translation log entries and/or visualizer tags in the output and must be resolved manually.

**`cycle`** — A confirmed dependency cycle: a path whose value depends on itself through an iterative ruleflow step. The containing rulesheets are classified as `fixpoint` (caller runs the loop externally), but the cyclic path itself has no automatic translation — the caller must express the convergence logic explicitly.

**`cycle-unclassified`** — A multi-node dependency cycle (A → B → … → A) not confirmed to be inside an iterative ruleflow step. Cannot be translated without manual investigation. Not observed in any real fixture; flagged defensively.

**`context-conflict`** — A rulesheet reached from more than one place in the ruleflow with conflicting invocation context (iterative via one path, non-iterative via another). Classification was resolved conservatively (treating it as iterative); needs manual review before translating any paths it writes. Not observed in any real fixture.

**`no-writer`** — Every rulesheet that writes this path was excluded from Fact compilation (entity-creation-tainted, unreachable, or no-op). No Fact could be compiled for the path at all. Needs manual review.

**`hit-policy-unverified`** — A variant of `decision-table`. Compiled assuming Corticon's default UNIQUE hit policy (rows mutually exclusive, order does not matter), but the file format has no hit-policy field to verify this against. If the rulesheet was authored with Rule Order hit policy, the compiled expression may be wrong. Flagged in the translation log for manual confirmation.

---

## Translation log fields

Every entry in the translation log (the `translationLog` array in `{slug}-blueprint-dsl.json`) carries:

- **`pattern`** — the universal pattern name from `src/translation-patterns.yaml`
- **`role`** — what the fact is in the graph: `input`, `derived`, `output`, `modifier`, or `excluded`
- **`translated`** — boolean: did the translator produce a fact for this? `false` means something blocked it or it is caller-responsibility
- Instance-specific fields depending on the pattern (e.g. `excludedRuleIds`, `collectionEntity`, `collectionField`, `assumption`, `sentinel`, `suggestedName`)

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
