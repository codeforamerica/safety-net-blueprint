# @codeforamerica/blueprint-rules-engine

> Browser-compatible rules evaluator for Blueprint dependency graph rulesets

[![npm version](https://img.shields.io/npm/v/@codeforamerica/blueprint-rules-engine.svg)](https://www.npmjs.com/package/@codeforamerica/blueprint-rules-engine)
[![license](https://img.shields.io/npm/l/@codeforamerica/blueprint-rules-engine.svg)](https://github.com/codeforamerica/safety-net-blueprint/blob/main/LICENSE)

> **Pre-release:** This package is at `0.x`. Until `1.0.0`, minor versions may include breaking changes. Pin your version if stability matters.

## Installation

```bash
npm install @codeforamerica/blueprint-rules-engine
```

## What it does

Evaluates a **compiled rule graph** — declarative CEL expressions that derive facts from
inputs such as household circumstances and policy parameters. It runs in Node.js and in
the browser, with no network call and no contract tooling installed.

Compiling a `*-rules.yaml` contract into a graph is a build step, and it belongs to
[`blueprint-core`](https://www.npmjs.com/package/@codeforamerica/blueprint-core). This
package is the runtime. Keeping the two apart is what lets the evaluator ship to a
browser: it depends on a CEL interpreter and nothing else.

## Usage

```js
import { evaluate } from '@codeforamerica/blueprint-rules-engine';

const nodes = evaluate(graph, {
  household: { members: [{ name: 'Alice', age: 22, employed: true }] },
  policy:    { minAge: 18, maxAge: 65 },
});

nodes.adultsFilter;
// { type: 'output', state: 'complete', value: [ { name: 'Alice', … } ] }
```

The return is a flat map of every fact in the graph, keyed by fact name. Inputs are keyed
by the graph's top-level namespaces — `{ household: … }` for paths beginning
`$.household`.

To produce the graph, compile the contract once at build time:

```js
import { discover, load, generate } from '@codeforamerica/blueprint-core';

const docs   = discover('./contracts', 'rules').map(load);
const graphs = generate(docs, 'graph');   // [{ graph, … }, …]
```

Compiled graphs are also written to disk as `*-graph.yaml` by `blueprint-resolve`, so a
consumer can load one directly rather than depending on core at all.

### Partial inputs

Inputs may be incomplete. Nothing throws — each fact reports what it could do:

| `state` | Meaning |
|---|---|
| `complete` | Resolved; every input it reads was supplied |
| `placeholder` | Resolved, but at least one input fell back to a default declared in the graph |
| `missing` | Could not compute; `missing` lists the input paths it could not reach |
| `error` | Could not compute; `message` says why (bad input type, failed expression, or a dependency in one of those states) |

Each node also carries `type`, either `output` (a fact the ruleset declares as an answer)
or `intermediate` (a step on the way to one).

Omit an input that has a declared default and the fact resolves, flagged:

```js
evaluate(graph, { household: { members } });   // no policy supplied

// adultsFilter → { type: 'output', state: 'placeholder', value: [ … ] }
// allEmployed  → { type: 'output', state: 'complete',    value: false }
```

Defaults are read from the graph's `inputs`, which declares them per field path, so
supplying part of a namespace still defaults the rest of it.

Omit one with no default and its dependents say exactly what they need:

```js
evaluate(graph, { policy: { minAge: 18, maxAge: 65 } });   // no household supplied

// adultsFilter → {
//   type: 'output', state: 'missing', value: null,
//   missing: ['$.household.members[]']
// }
```

That list is what drives progressive disclosure: ask for the inputs the pending outputs
actually need, and nothing else.

## TypeScript

Types ship with the package — no `@types` install.

```ts
import { evaluate, type Graph, type FactNode } from '@codeforamerica/blueprint-rules-engine';

const nodes: Record<string, FactNode<unknown>> = evaluate(graph, inputs);

if (nodes.adultsFilter.state === 'missing') {
  nodes.adultsFilter.missing;   // string[] — narrowed by the discriminated union
}
```

`FactNode` is a union discriminated on `state`, so `missing` and `message` are reachable
only on the states that carry them.

For per-ruleset input and result types rather than `unknown`, generate a client with
`blueprint-generate-ts-clients`: it emits `${Ruleset}Inputs` and `${Ruleset}Result` and a
`Rules` export that embeds the graph.

## Browser

A pre-built IIFE bundle ships at `dist/browser.js`, exposed through the `./browser`
package export. Loaded from a script tag it sets `window.RulesEngine`:

```html
<script src="https://unpkg.com/@codeforamerica/blueprint-rules-engine/dist/browser.js"></script>
<script>
  const nodes = window.RulesEngine.evaluate(graph, {
    household: { members: [{ name: 'Alice', age: 22, employed: true }] },
  });
</script>
```

The bundle is an IIFE and exports nothing importable, so the global is the only way to
reach it. With a bundler, import `evaluate` from the package root instead — the global is
typed via `declare global` for the script-tag case.

The bundle is regenerated from source by `npm run build:browser`, and `prepare` runs it
before publish. `dist/browser.js` is committed, and preflight fails if it has drifted from
`src/`.

## Related packages

- [`@codeforamerica/blueprint-core`](https://www.npmjs.com/package/@codeforamerica/blueprint-core) — compiles rulesets into graphs and resolves contracts
- [`@codeforamerica/blueprint-cli`](https://www.npmjs.com/package/@codeforamerica/blueprint-cli) — `blueprint-evaluate` runs rulesets from the command line; `blueprint-generate-ts-clients` emits typed per-ruleset clients
- [`@codeforamerica/blueprint-mock-server`](https://www.npmjs.com/package/@codeforamerica/blueprint-mock-server) — serves a POST endpoint for every ruleset that declares an `endpoint:`
