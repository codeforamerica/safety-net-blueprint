# Forward-chaining vs. reverse-chaining rules engines

Corticon (see [`CORTICON-GLOSSARY.md`](./CORTICON-GLOSSARY.md)) and the decision-rules DSL this
spike is de-risking (see [`DEPENDENCY-GRAPH-GLOSSARY.md`](./DEPENDENCY-GRAPH-GLOSSARY.md)) are two
different styles of rules engine. This doc explains that difference, compares them head-to-head,
argues why the reverse-chaining style is the better fit for a benefits program specifically, is
honest about what it costs to make that choice, and explains why translating one into the other is
hard.

## Forward-chaining

A forward-chaining engine evaluates rules in a fixed order: it runs through a defined sequence
(Corticon's ruleflow), and at each step, reacts to whatever data is available. If a rule's
conditions are met, its actions run and update the data; later steps can then react to those
updates. Evaluation is driven by "what order should I run rules in," not by any particular
question being asked.

Corticon is forward-chaining. So are most legacy business-rules engines and hand-written
eligibility scripts — and so, notably, is the large majority of the commercial case-management
market: IBM Cúram's CER, IBM ODM, Drools, and FICO Blaze Advisor are all forward-chaining.
Reverse-chaining is the minority architecture in this space.

## Reverse-chaining (backward-chaining)

A reverse-chaining engine starts from a question instead of a sequence: "is this household
eligible?" It works out what facts that question depends on, then recursively asks for each of
those, stopping once it reaches facts that are already known (supplied as input) or facts it
can't yet determine. This means:

- It only computes what's actually needed to answer the question asked — not everything a
  forward-chaining script would run through regardless.
- It can produce a genuinely partial answer when only some input is available, rather than an
  all-or-nothing result at the end of a full run. This matters for showing an applicant a partial
  eligibility picture mid-application, before every piece of information has been collected.
- Its natural internal representation is a **dependency graph** — see
  [`DEPENDENCY-GRAPH-GLOSSARY.md`](./DEPENDENCY-GRAPH-GLOSSARY.md) — since "what does this fact
  depend on" is exactly the question it needs to answer at every step.

Reverse-chaining is a real but minority architecture: Oracle Intelligent Advisor, Open Policy
Agent (Rego), and IRS Direct File's Fact Graph are the clearest examples, none of them from the
mainstream case-management vendor world.

## Comparing the two head-to-head

Neither style is categorically better — each fits a different shape of problem, which is exactly
why the commercial market is dominated by one and this DSL deliberately chose the other.

**Forward-chaining wins when:**

- **The calculation is genuinely iterative.** A value that has to be nudged repeatedly until it
  converges (a numerical root-solver, an amortization schedule) is a direct fit for a
  loop-until-stable ruleflow step. Reverse-chaining has no native equivalent — see
  [Why translating between them is hard](#why-translating-between-them-is-hard).
- **Rule authors think procedurally.** Many business-rule authors — including policy analysts
  trained on paper worksheets — think in terms of "first do this, then do this." A forward-chaining
  ruleflow diagram matches that mental model directly; a dependency graph asks the author to think
  in terms of "what does this depend on" instead.
- **Authoring tooling maturity matters more than architecture.** Corticon, Cúram, and ODM all have
  decades-old, refined visual decision-table and ruleflow editors built for non-programmer rule
  authors. Nothing comparably mature exists yet for a reverse-chaining engine outside Oracle's
  commercial product.

**Reverse-chaining wins when:**

- **An answer is needed before all the inputs exist.** This is the one thing forward-chaining
  fundamentally cannot do without separate add-on machinery (see the Cúram comparison below): a
  reverse-chaining engine reports "here's what I can determine so far, and here's exactly what's
  still missing" as a structural property of how it evaluates, not a bolted-on feature.
- **The result needs to be explained fact-by-fact.** A dependency graph *is* the explanation: "X is
  what it is because Y and Z, which are what they are because…" Forward-chaining's explanation is a
  trace of which rules fired in which order — it answers "what happened," not "what does this
  depend on."
- **Only part of a large rule set is relevant to the question actually being asked.**
  Reverse-chaining computes only what the specific question needs. Forward-chaining runs everything
  in the ruleflow regardless of whether a given step's output is ever used for this particular case.

## Why reverse-chaining is the better fit for a benefits program

The central capability this whole design effort exists for — showing an applicant a live,
partial eligibility picture during intake, before every piece of information has been collected —
is a reverse-chaining-native capability, not a forward-chaining one. That's not a minor convenience;
real intake is incremental (applicants fill out multi-page forms over multiple sessions, upload
verification documents over days or weeks), and a household's likely eligibility is useful
information well before the application is complete.

Forward-chaining engines aren't incapable of anything like this — **IBM Cúram is the real
counter-example worth taking seriously.** Its Evidence model supports genuine "provisional
determinations," explicitly documented as "any result presented is provisional, dependent upon the
client providing supporting documentation," backed by e-verification and an evidence-completeness
"concerns" list. This is a decades-proven, production-hardened pattern, not a strawman. But the
capability lives in the *orchestration/evidence layer wrapping the rules engine*, not in the engine
itself — CER underneath is still a forward-chaining engine with no native completeness propagation
through derived calculations. Every new derived value needs someone to separately, manually author
its completeness/evidence logic in that wrapping layer, kept in sync by hand with the calculation
it describes. Progress Corticon's own documentation goes further in the other direction: it
recommends *validation Rulesheets that terminate execution if data is incomplete*, treating
incompleteness as an error condition to reject rather than a state to represent at all.

Reverse-chaining makes completeness a property of the engine itself: a derived fact is only "known"
if everything it depends on is known, automatically, for every fact, with no parallel system to
keep in sync. For a domain where showing partial results safely is the actual point, that's a real
architectural advantage, not just a stylistic preference.

Two more considerations specific to this domain:

- **Explainability is close to a legal requirement here, not just a nice-to-have.** Benefits
  determinations routinely need to be explained to an applicant or defended to an auditor in terms
  of exactly which facts drove the result. A dependency graph's "what does this depend on"
  structure supports that directly; a forward-chaining rule-firing trace answers a different
  question ("what ran") that has to be manually translated into "why," rule by rule.
- **Real eligibility regulations are already more declarative than the paper-worksheet format
  suggests.** This spike's own research (issue [#388](https://github.com/codeforamerica/safety-net-blueprint/issues/388))
  found that both DC Medicaid/CHIP's and Mortgage's real program-cascade logic use plain sequential
  steps with per-rule filtering — no `BranchContainer`, no iteration, no genuine cycle, in either
  official sample. Eligibility rules have historically been written to be computable by a caseworker
  via a sequential worksheet (gross income test, then net income test, then asset test) — a
  historical hand-computability constraint, not evidence that the underlying logic is inherently
  sequential. Those tests are independently decidable facts, which is exactly the shape a dependency
  graph represents natively. Translating them into declarative Facts is largely surfacing a
  structure that's already implicitly there, not fighting the domain's natural shape.

## Reverse-chaining's real limitations — and how to mitigate them

None of this makes reverse-chaining free. Four real costs, and what this design does about each:

1. **No native iterative/convergence calculation** (see the next section). This is the one thing a
   single backward derivation genuinely cannot express. *Mitigation:* per the domain research above,
   genuine cycles appear to be rare or absent in real benefits-eligibility content specifically — so
   the cost is low in practice. Where one does turn out to be needed, the fix isn't to force the
   dependency graph to model a loop — it's to hide the iteration inside a single opaque function that
   performs its own bounded internal convergence and exposes only the final, converged value as one
   ordinary Derived fact. The graph still sees a plain dependency; the iteration lives entirely
   inside that one function's implementation.

2. **Pure procedural sequencing has no natural home in a dependency graph.** A graph is organized
   around "what needs what," not "what happens in what order" — so a business requirement like
   "always evaluate category A fully before touching category B," where B doesn't actually need A's
   *value*, doesn't translate cleanly. *Mitigation:* where the ordering really does reflect a data
   dependency, model it as one (make B formally depend on A, even if the expression doesn't use A's
   value directly). Where it's a pure orchestration/business-process concern with no real data
   dependency at all, relocate it to the adapter/orchestration layer outside the fact graph entirely
   — the same relocation this spike already applies to entity-creation and service-callout patterns
   (see [`TRANSLATION-PATTERNS.md`](./TRANSLATION-PATTERNS.md)), which are flagged as orchestration
   concerns rather than forced into the Fact model.

3. **Authoring and tooling maturity lag decades behind the forward-chaining incumbents.** Corticon,
   Cúram, and ODM all have refined, non-programmer-friendly visual editors; nothing comparable exists
   yet for a dependency-graph engine outside Oracle's commercial product. *Mitigation:* the design
   doc's Decision 10 plans a visual dependency-graph viewer specifically to close this gap, reusing
   `packages/explorer`'s existing graph-rendering infrastructure rather than building authoring
   tooling from zero. This spike's own classification work (recognizing decision-table
   combinatorics, filters, entity creation, and the rest) is also exactly what a translator would
   need to render an *existing* Corticon ruleset in that same viewer, for direct side-by-side
   comparison during a real migration — not just a one-way conversion.

4. **Rule authors trained on procedural worksheets face a real cognitive shift.** *Mitigation:* as
   argued above, real eligibility regulations already tend to decompose into independent, declarative
   tests rather than genuinely sequential logic — the shift is smaller than it first appears, because
   the declarative structure is mostly already latent in the regulations themselves. A visual
   dependency-graph view (Decision 10, same as above) lowers the remaining gap further by letting
   authors work with a rendered graph rather than raw expressions.

## Why translating between them is hard

Reverse-chaining can't express one thing forward-chaining can: a value that's determined through
repeated adjustment (an iterative calculation that keeps nudging a guess until it converges). A
single backward derivation only computes a fact once; it doesn't have a native notion of "keep
recalculating this until it stabilizes."

Most of the difficulty in translating a real forward-chaining ruleset comes from patterns that
*look* the same in the underlying dependency graph — a value that depends on itself — but mean
entirely different things depending on why the original rule was written that way:

- A genuine iterative calculation (the one case reverse-chaining can't express directly, and needs
  to be flagged rather than mistranslated).
- An ordinary rule-table row that happens to check the same field it's an alternative for.
- A rule filling in a placeholder default for a value that simply isn't known yet.

Since a forward-chaining engine runs everything regardless of which of these it's looking at,
these differences don't need to be told apart at runtime — the engine just executes each rule.
A reverse-chaining translation has to actually classify which case it's looking at, or it will
either wrongly demand impossible iteration, silently produce the wrong value, or drop real logic.
Working out how to do that classification correctly and validate it against real forward-chaining
rulesets is the actual point of this spike.
