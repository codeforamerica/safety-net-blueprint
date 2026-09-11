# @codeforamerica/blueprint-rules-engine

> Browser-compatible rules evaluator for Blueprint dependency graph rulesets

[![npm version](https://img.shields.io/npm/v/@codeforamerica/blueprint-rules-engine.svg)](https://www.npmjs.com/package/@codeforamerica/blueprint-rules-engine)
[![license](https://img.shields.io/npm/l/@codeforamerica/blueprint-rules-engine.svg)](https://github.com/codeforamerica/safety-net-blueprint/blob/main/LICENSE)

> **Pre-release:** This package is at `0.x`. Until `1.0.0`, minor versions may include breaking changes. Pin your version if stability matters.

## Installation

```bash
npm install @codeforamerica/blueprint-rules-engine
```

## What It Does

Evaluates Blueprint dependency graph rulesets — declarative CEL expressions that compute eligibility facts from household and policy inputs. Designed to run in both Node.js and the browser.

Facts are returned in four states:

| State | Meaning |
|-------|---------|
| `complete` | Resolved; all inputs were explicitly provided |
| `placeholder` | Resolved; at least one input fell back to a schema default |
| `missing` | Could not compute; required inputs were absent |
| `errors` | Expression threw during evaluation |

## Usage

### Evaluate a ruleset from a `*-rules.yaml` document

```js
import { evaluate } from '@codeforamerica/blueprint-rules-engine';
import { readFileSync } from 'fs';
import yaml from 'js-yaml';

const rulesDoc = yaml.load(readFileSync('snap-rules.yaml', 'utf8'));

const result = evaluate(rulesDoc, {
  household: { size: 3, monthlyIncome: 2400 },
  policy:    { incomeLimitMultiplier: 1.3 }
});

console.log(result.complete);
// { meetsIncomeTest: true, isEligible: true }

console.log(result.missing);
// { hasQualifyingImmigrationStatus: ['$.household.immigrationStatus'] }
```

### Evaluate a pre-compiled graph directly

```js
import { evaluateGraph } from '@codeforamerica/blueprint-rules-engine';

// graph is the output of compileRuleset() from @codeforamerica/blueprint-core
const result = evaluateGraph(graph, {
  household: { size: 3, monthlyIncome: 2400 }
});
```

Use `evaluateGraph` when you have already compiled the ruleset (e.g. at server startup) and want to skip the compilation step on each request.

## API

### `evaluate(rulesDoc, inputs, [rulesetName])`

| Parameter | Type | Description |
|-----------|------|-------------|
| `rulesDoc` | `Object` | Parsed `*-rules.yaml` document |
| `inputs` | `Object` | Named input objects (e.g. `{ household, policy }`) |
| `rulesetName` | `string` | Ruleset to evaluate; defaults to the first ruleset in the document |

Returns `{ complete, placeholder, missing, errors }`.

### `evaluateGraph(graph, inputs)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `graph` | `Object` | Compiled graph from `compileRuleset()` or a parsed `*-graph.yaml` |
| `inputs` | `Object` | Named input objects |

Returns `{ complete, placeholder, missing, errors }`. No schema defaults are applied — all inputs must be explicit.

## Related packages

- [`@codeforamerica/blueprint-core`](https://www.npmjs.com/package/@codeforamerica/blueprint-core) — compiles rulesets and resolves contracts
- [`@codeforamerica/blueprint-mock-server`](https://www.npmjs.com/package/@codeforamerica/blueprint-mock-server) — mock API server that runs rulesets at the `/rules-eval` endpoint
