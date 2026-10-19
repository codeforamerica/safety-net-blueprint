# @codeforamerica/blueprint-rules-engine

## 0.2.0

### Minor Changes

- Before, the engine had no notion of a value fixed by the ruleset. Now it reads a graph's `constants` into scope as `constants`, a caller can't replace them, and a result resting on one is complete. The FactGraph translator writes each as a Derived literal so the two evaluators agree. (#481)
- Before, a fact reading a field one list item didn't have, such as a household member with no `dateOfBirth`, came back as an error. Now it's `missing`, naming the item path, unless another item or the rest of the expression already settles the answer. (#488)
- **Breaking:** a fact built with `&&`, `||`, `!` or `? :` now gets the state its result actually rests on, as Fact Graph's All, Any and Switch do. Before, a fact's state was read off its dependency list before evaluation — any defaulted input made it `placeholder`, any missing one made it `missing` — even when that input did not decide the answer. Now `false && x` is `complete` whatever `x` is; a defaulted `true` settles an `||` as a `placeholder`; a defaulted `false` does not settle an `&&` while another operand is missing, so the result is `missing`. A conditional whose condition is missing stays `missing`. Errors are unchanged: a wrong-type input still errors every fact that reads it.

  Facts that used to come back `missing` or `placeholder` may now come back `complete` or `placeholder`. If you branch on a fact's state, check those branches.

### Patch Changes

- Each package now declares its license, `PolyForm-Noncommercial-1.0.0`, so npm and dependency scanners show it. The terms are unchanged. (#452)
- Before, the rules engine evaluated CEL with a setup of its own, separate from the one used for state machine and composition expressions. Now it uses `@codeforamerica/blueprint-core/cel`, which it depends on, so a ruleset and a guard are evaluated the same way. (#445)
- Before, a date declared as an input of its own, such as `asOf`, reached expressions as a map, so `asOf.getFullYear()` failed. And a fact returning records that held dates failed with "cannot use getEvalContext outside of an evaluation". Now a top-level date is a timestamp, like a date inside an object, and records holding dates come back as values. (#481)
- Uses @codeforamerica/blueprint-core 0.4.0.
