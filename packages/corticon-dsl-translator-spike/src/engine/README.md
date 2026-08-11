# engine

CEL-based graph evaluator. Walks the universal rule graph (`graph.json`), resolves
input values, and computes derived nodes in dependency order.

Planned:
- Graph evaluator (topological sort + CEL evaluation)
- Custom CEL functions: `yearsBetween`, `round`, `sum`
