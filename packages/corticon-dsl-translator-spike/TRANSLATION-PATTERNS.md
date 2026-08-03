# Translation patterns

This spike's actual job (issue [#388](https://github.com/codeforamerica/safety-net-blueprint/issues/388)) is to translate a real forward-chaining Corticon ruleset into the reverse-chaining, dependency-graph-based decision-rules DSL (see [`FORWARD-VS-REVERSE-CHAINING.md`](./FORWARD-VS-REVERSE-CHAINING.md) and [`DEPENDENCY-GRAPH-GLOSSARY.md`](./DEPENDENCY-GRAPH-GLOSSARY.md)). These aren't concepts either engine has natively — they're patterns that only exist *because* one model is being converted into the other, and each one needs to be recognized and handled correctly rather than translated literally.

This isn't a fixed, closed catalog written once before implementation started. New real patterns kept surfacing purely from the process of building the translator — operator precedence, decision-table hit-policy semantics, sequence-indexing base, cross-rulesheet invocation order — none of which were anticipated before implementation forced the question. Identifying new translation patterns as real data is encountered is an ongoing goal of this spike in its own right, not just a byproduct of it.

## Evidence status, at a glance

Every pattern below is one of three states — deliberately not blended into a single "confirmed" bucket, since the difference matters for how much to trust a translation built on it:

- **Proven** — a real, executed golden-master trace (captured `Test.ert` input/output) demonstrates it, or Corticon's own documentation states it unambiguously with no room for a competing reading.
- **Evidence-based** — real example(s) found (vendored fixtures, or real third-party Corticon projects on GitHub), no counter-evidence found, but no executed trace independently proving the specific behavior.
- **Unresolved** — actively checked (documentation, real projects, or both) and still genuinely unknown; flagged rather than guessed at.

| Pattern | Status | Evidence |
|---|---|---|
| Ordinary cross-rulesheet dependency | Proven | DC Medicaid/CHIP, real captured `Test.ert` trace |
| Genuine cycle (iterative convergence) | Proven | IRR, real captured `Test.ert` trace |
| One-directional dependency dressed in `iterative` | Evidence-based | Reasoned from the confirmed general `iterative` mechanism plus a minimal original reconstruction — not an independent captured Corticon trace (issue #388's one acknowledged gap) |
| Entity creation / association mutation (`.new`/`.newUnique`/`.add`) | Proven | DC Medicaid/CHIP's own real `Household.newUnique[...]` and `members += Person` actions |
| Service call-outs (`connectorList`) | Proven | `corticon.js-samples/ServiceCallOut/RESTCall/Fetch.erf`, real confirmed shape |
| Decision-table combinatorics — the mechanism (multiple rows, one output) | Proven | DC Medicaid/CHIP's `MAGI Eligibility Groups` (17 real rows) |
| Decision-table combinatorics — row order is safe to compile arbitrarily | Proven for the default case | Corticon's documented default hit policy is UNIQUE (rows required mutually exclusive), enforced by Corticon Studio's own "Predicate Logic Matrix" conflict checker at design time |
| Decision-table combinatorics — detecting a non-default "Rule Order" hit policy | Unresolved | Corticon's real, documented "Rule Order" hit policy allows overlapping rows (breaks first-match-wins compilation) — checked every real fixture's raw XML for a hit-policy attribute and found none; this translator cannot detect which policy a given rulesheet used, and surfaces this as a crosswalk annotation on every multi-row Fact rather than silently assuming UNIQUE |
| Cross-rulesheet Fact assembly — the mechanism (multiple rulesheets, one Fact) | Proven | DC Medicaid/CHIP's `Parse Cohorts.ers` + `Flatten.ers`, jointly determining `Person.MedicaidEligible` |
| Cross-rulesheet Fact assembly — resolution order | Proven | Progress's own documentation: "if a connector is drawn from Rulesheet sample1.ers to sample2.ers, when a deployed Ruleflow is invoked, it will execute sample1.ers first, followed by sample2.ers" — resolved from each rulesheet's real ruleflow node position, not discovery order (see `ruleflow-context.js`'s `firstInvocationOrder`) |
| Conditional branching (`BranchContainer`) | Proven | `HOUDAAHMAD` insurance-rating projects, real confirmed `<condition>` + `<branches>` schema |
| Null-check masking → Placeholder | Proven | `Mortgage/Regular_NoData.ers`, real captured `Test.ert` trace |
| Date/age arithmetic (`yearsBetween`, `addYears`) exists as a real construct | Proven | DC Medicaid/CHIP's own `Person.dob.yearsBetween(today)` |
| Date/age arithmetic CEL mapping (`yearsBetween`/`addYears` custom functions) | Evidence-based (proposed) | No CEL native equivalent; names proposed here feed back into decision-rules-dsl.md's still-open Decision 4, not settled fact |
| Currency/decimal rounding exists as a real construct, including the no-term compound-expression gap | Proven | DC Medicaid/CHIP's own `.round(2)` usage, confirmed via direct XML inspection |
| Currency/decimal rounding CEL mapping (`round` custom function) | Evidence-based (proposed) | Same status as date arithmetic above |
| Sorting/ranking (`sortedBy`/`sortedByDesc`, ascending by default) | Proven | Progress's own Corticon Rule Language documentation states `sortedBy` is ascending, with a separate `sortedByDesc` for descending |
| Sorting/ranking `->at(n)` is 1-based, not 0-based | Evidence-based | Two independent real Corticon projects (`corticon-classic-samples`'s "Ranking and Ordering", `Seth-Meldon/criticality`'s "Health Risk"), no counter-evidence found, no populated captured trace located after two search passes — see `to-cel.js`'s own comment for the full reasoning |
| Sorting/ranking CEL mapping (`nthByKey` custom function) | Evidence-based (proposed) | Same status as date arithmetic/rounding above |
| Scope/Alias/Filter mechanism | Proven | `Mortgage/Select_Credit.ers`, real confirmed filter shape |
| Scope/Alias/Filter — a rulesheet's filters gate EVERY rule sharing that scope, not just rules referencing the filtered term | Proven | Progress's own documentation: "other business rules will fire if and only if data ... survives the Filter, and shares the same scope as the rules." Confirmed against a real example that specifically tests this: DC Medicaid/CHIP's `Parse Cohorts.ers` has a real filter (`cohorts->notEmpty`) and a real rule (`Person.MedicaidEligible = T`) that does not reference `cohorts` at all, yet is still gated by it. An earlier version of this translator ignored filters when compiling guards entirely, producing a real, silently wrong Fact -- fixed once this was checked rather than assumed |
| Scope/Alias/Filter full-vs-limiting cascade behavior | Unresolved | Explicitly flagged in issue #388 itself as needing live execution behavior to resolve, not resolvable from static file inspection |
| Range membership (`X in (lower..upper]`, brackets independently optional per side, translates fully to native CEL comparisons -- no custom function needed) | Proven | DC Medicaid/CHIP's own `Person.age in ( 18 .. 26 )`, `Person.HouseholdActualPercentFPL in ( 220 .. 250 ]`, and `Person.age in 21 .. 64` (confirmed via the real `expression` attribute, `[21..64]`, that an omitted bracket means inclusive, not "no bound") |
| `->notEmpty` (CEL has no native equivalent; maps to `size(x) != 0`) | Proven | DC Medicaid/CHIP's own real rulesheet filter in `Parse Cohorts.ers` |
| Unreachable rulesheet (never invoked) | Proven | DC Medicaid/CHIP's own `Non-MAGI Eligibility Groups.ers`, confirmed never referenced by any real `.erf` in the project |
| Unreachable rulesheet — its writes must be explicitly excluded from Fact compilation, not just detected | Proven | Confirmed real, not theoretical: `Non-MAGI Eligibility Groups.ers` also writes `Person.outputCoverage1`, the same path the real, reachable `Flatten.ers` writes. An earlier version of this translator detected unreachability but never excluded it from cross-rulesheet assembly/decision-table compilation, so this dead rulesheet's logic was silently eligible to be compiled in as if live |
| Operator precedence (unary `-`/`not` > multiplicative `*` `/` `**` > additive `+` `-` > relational > logical `and`/`or`, left-associative) | Proven | Progress's own "Operator precedence and order of evaluation" documentation, cited directly |
| `**` (exponentiation) is the same precedence tier as `*`/`/`, not higher | Proven | Same documentation — explicitly not most general-purpose languages' convention |
| `<>` is Corticon's real not-equal spelling | Proven | Same documentation |
| `and`/`or`/`not` are real Corticon operators | Proven to exist, not yet seen in a fixture | Same documentation confirms these are real syntax; no fixture in this spike happens to use them yet, which is a different claim from "not real" |
| Double-quoted string literals | Unresolved | Tokenizer accepts them defensively; no real example or documentation found confirming or ruling this out |

## What the faithful ingestion model deliberately excludes

Phase 1 ingestion (`src/corticon/`) is meant to be faithful -- no rule, condition, action, or human-authored documentation silently dropped (see "Fail loudly, not silently" below). That standard was checked directly, not assumed: every real leaf value in a rulesheet's raw parsed XML was diffed against `parseRulesheet`'s own extracted output for DC Medicaid/CHIP's `MAGI Eligibility Groups.ers`. Two real gaps that check found are now fixed and covered by tests: Corticon Studio's own reserved blank/template row (previously filtered out, silently shifting every later rule's index away from Corticon's own numbering) and per-rule `documentingRuleStatements`/`ruleStatement` business-readable comments (previously dropped entirely).

What's still deliberately excluded, and why each is confirmed to be presentation/plumbing rather than real rule content -- not assumed unimportant, checked:

| Excluded | Real example checked | Why it's safe to drop |
|---|---|---|
| Grid-cell `valueSet`/`viewExpressions` shorthand (e.g. `<viewExpressions lhs="Person.age" rhs="{19, 20}"/>`, `<actionValueSetCellList valueSet="'Medicaid for Breast and Cervical Cancer Patients'">`) | MAGI Eligibility Groups.ers | Confirmed redundant, not new content: `{19, 20}` is Corticon Studio's own compact display of the real condition `Person.age = 19 or Person.age = 20`, which `parserOutput.text` already captures in full. Checked by grepping the raw XML for each candidate value and finding the equivalent full expression already present elsewhere in the same rule |
| UI layout metadata (`rowHeight`, `columnWidth`, `sashWeight*`, `scrollRowTop`, `rowCount`/`columnCount`) | Every real `.ers` fixture | Corticon Studio's own grid rendering hints -- no rule-semantic content, confirmed by direct inspection (pure numbers with no corresponding business meaning) |
| EMF internal cross-references (`#//@ruleset/@rules.N`, `#//@ruleset/@logicalVariables.N`, etc.) | Every real `.ers` fixture | Structural plumbing for resolving links *within* the same XML document; the information those links carry (which rule, which logical variable) is already captured by array position or by `refIndex()`'s own explicit resolution, not lost |
| Rulesheet-scope vocabulary path declarations (`<referencedAttributes attribute="../Vocabulary/Rule%20Vocabulary.ecore#//Person/age"/>`) | MAGI Eligibility Groups.ers | Corticon Studio's own "what's in scope for this rulesheet's column picker" bookkeeping -- redundant with `vocab.ecore`'s own attribute definitions (parsed separately by `vocabulary.js`) and with each actually-used term's own `datatype`, which is already captured |
| Pure XMI/EMF asset metadata (`buildNumber`, `updateStamp`, `externalChecksum`, `studioType`, namespace URIs, `xsi:type` discriminators) | Every real fixture | Asset versioning and structural type-tagging, not rule content -- `xsi:type` values are already consumed to decide *how* to parse a node (e.g. distinguishing `BranchContainer` from `ActivityNode` in ruleflow.js), just not re-emitted verbatim |

Column-level metadata (`rulesheetViewList`'s `actionItemList`/`conditionItemList`, including real human-authored `naturalLanguageText` descriptions) is the one exception captured *without* a fully understood use yet -- see `rulesheet.js`'s own comment on `extractColumnDefinitions` and issue #388's Phase 5 plan. That's a deliberate "capture faithfully now, decide how to use later" call, not an oversight: the real column-to-rule correspondence isn't confirmed, but the raw data itself is real and worth keeping regardless.

## The three-way self-loop ambiguity

A dependency-graph self-loop (a value that depends on itself) is structurally identical no matter why it exists — but the same raw shape shows up for three completely different real reasons in a Corticon ruleset:

1. **Genuine cycle** — a real "keep adjusting until it converges" calculation (e.g. an interest-rate solver that nudges its guess up by a small amount each pass until the answer stops changing). This is the one case the target DSL genuinely can't express as a single backward derivation, since it requires *iteration*.
2. **Ordinary decision-table alternative row** — a rule table has multiple rows, and one row's condition happens to check the same field another row sets, purely because they're mutually-exclusive alternatives in the same table — nothing is actually being repeated.
3. **Null-check masking** — a rule checks "is this still unknown?" and if so, fills in a default. Structurally this reads and writes the same field, but semantically it's "supply a placeholder for a value nobody has given us yet," which the target DSL has a native mechanism for (a Placeholder), not a calculation to translate literally.

Telling these apart needs more than the raw graph: the specific rule's own condition text (does it check for null?), and whether that rule is ever reached from inside a Ruleflow step marked `iterative` (see [`CORTICON-GLOSSARY.md`](./CORTICON-GLOSSARY.md)) — which requires resolving **invocation context** (below) first.

## Cross-rulesheet Fact assembly

In Corticon, a single value isn't always decided by one rule, or even one rulesheet — it can be decided by *several separate rulesheets*, each contributing part of the answer under different conditions (e.g. one rulesheet sets "eligible" when a specific test passes, and a completely different rulesheet later sets "not eligible" as the fallback if nothing else matched). The target DSL has no equivalent of this at all: a Derived fact has exactly one expression. Translating each rulesheet in isolation would either produce two conflicting Facts sharing a name, or silently drop half the logic — so this has to be recognized and the combined logic merged into a single correct expression.

This is a genuinely separate, independent fact about a value from "does it have a self-loop": a value can be assembled across multiple rulesheets *and* have no self-loop at all (the common real case), or have a self-loop that has nothing to do with assembly.

## Invocation context

Whether a Corticon rulesheet is "inside a loop" or "inside a branch" depends entirely on *how the Ruleflow invokes it* — nothing in the rulesheet file itself says so. Working this out requires walking the whole Ruleflow, including nested Ruleflows that invoke other Ruleflows, starting from each entry point, to determine, for every rulesheet: is it ever reached from inside an `iterative` step? From inside a `BranchContainer`? This resolved context is what makes the self-loop disambiguation above possible at all.

## Classification

The overall term for this whole process: for every dependency the graph finds, work out *what kind of thing it actually is* (an ordinary dependency, a genuine cycle, an assembled Fact, a null-check default, entity creation, a service call-out, etc.) before deciding how to translate it — rather than naively translating the literal shape and getting the wrong answer for the cases above. See issue #388's classification pattern table for the full list of patterns this translator handles, each backed by a real confirmed example from a vendored Corticon project.

## Fail loudly, not silently

| Risk | Mitigation |
|---|---|
| A mechanical translator can silently mistranslate an expression it doesn't actually understand, producing plausible-looking but wrong CEL — which would undermine the whole point of this spike's golden-master verification: a wrong translation could coincidentally still pass a diff against a captured trace, or fail in a way that doesn't localize to the actual bug | Every translation stage (the Corticon expression-text parser, and the generic AST-to-CEL generator) is scoped to only the constructs confirmed real across this spike's fixtures, and throws a specific, actionable error on anything outside that set rather than guessing. An unsupported construct becomes a visible failure to investigate, not a silent wrong answer to trust |
