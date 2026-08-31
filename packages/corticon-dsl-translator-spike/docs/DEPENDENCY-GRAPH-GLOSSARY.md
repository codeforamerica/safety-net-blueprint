# Dependency-graph glossary

An alternative way to represent business rules: not as "a script that runs top-to-bottom," but as
a **dependency graph** — for every value a rule computes, what other values does it need first?
This glossary explains that model and the vocabulary used to reason about it. For how this
compares to a traditional forward-chaining engine like Corticon, see
[`FORWARD-VS-REVERSE-CHAINING.md`](./FORWARD-VS-REVERSE-CHAINING.md).

## The basic model

- **Node** — a single named value, addressed as `EntityType.attributeName` (e.g.
  `Household.totalIncome`). Every field any rule reads or writes becomes a node.
- **Edge** — a "depends on" relationship: an edge from A to B means "computing B requires
  knowing A first." Built by walking every rule's conditions (what it reads) and actions (what it
  writes).
- **Read** — an attribute a rule's condition or action *looks at* to make its decision.
- **Write** — an attribute a rule's action *sets*.
- **Canonical path** — different rules can give the same underlying business object different
  local nicknames. "Canonical" means resolved back to the object's real type name, so the same
  underlying field matches up correctly everywhere it's touched, regardless of what nickname was
  used in any one place.
- **Cycle** — following the "depends on" arrows in a loop and ending up back where you started
  (A depends on B, B depends on A).
- **Self-loop** — the simplest case of a cycle: a value that depends on itself directly (e.g. a
  rule that reads `X` and also writes `X`).

For the patterns this spike's translator specifically needs to detect when a cycle, self-loop, or
similar shape turns up in a real Corticon ruleset — and why the same raw shape can mean genuinely
different things — see [`TRANSLATION-PATTERNS.md`](./TRANSLATION-PATTERNS.md).
