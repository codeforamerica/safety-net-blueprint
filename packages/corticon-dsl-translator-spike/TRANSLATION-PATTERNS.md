# Translation patterns

This spike's actual job (issue [#388](https://github.com/codeforamerica/safety-net-blueprint/issues/388)) is to translate a real forward-chaining Corticon ruleset into the reverse-chaining, dependency-graph-based decision-rules DSL (see [`FORWARD-VS-REVERSE-CHAINING.md`](./FORWARD-VS-REVERSE-CHAINING.md) and [`DEPENDENCY-GRAPH-GLOSSARY.md`](./DEPENDENCY-GRAPH-GLOSSARY.md)). These aren't concepts either engine has natively — they're patterns that only exist *because* one model is being converted into the other, and each one needs to be recognized and handled correctly rather than translated literally.

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
