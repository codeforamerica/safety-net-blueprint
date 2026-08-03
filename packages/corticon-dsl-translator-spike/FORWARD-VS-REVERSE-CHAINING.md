# Forward-chaining vs. reverse-chaining rules engines

Corticon (see [`CORTICON-GLOSSARY.md`](./CORTICON-GLOSSARY.md)) and the decision-rules DSL this
spike is de-risking (see [`DEPENDENCY-GRAPH-GLOSSARY.md`](./DEPENDENCY-GRAPH-GLOSSARY.md)) are two
different styles of rules engine. This doc explains that difference and why it matters for
translating one into the other.

## Forward-chaining

A forward-chaining engine evaluates rules in a fixed order: it runs through a defined sequence
(Corticon's ruleflow), and at each step, reacts to whatever data is available. If a rule's
conditions are met, its actions run and update the data; later steps can then react to those
updates. Evaluation is driven by "what order should I run rules in," not by any particular
question being asked.

Corticon is forward-chaining. So are most legacy business-rules engines and hand-written
eligibility scripts.

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
