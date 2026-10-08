# @codeforamerica/blueprint-harness

> Shared sample contracts and generated artifacts for testing blueprint tooling packages

This is a private, internal package. It is not published to npm.

## What it contains

A complete sample blueprint project, used as the shared test fixture across all blueprint tooling packages (`blueprint-cli`, `blueprint-explorer`, `blueprint-rules-engine`, etc.). Four domains carry resources — intake, eligibility, platform and document-management — and scheduling contributes an events channel only.

| Directory | Contents |
|-----------|----------|
| `contracts/` | Source contract files — the inputs that tooling packages process |
| `mock/` | The demo page source, built into `generated/mock/` |
| `explorer/` | Explorer configuration and authored content (not generated) |
| `generated/resolved/` | Resolved output produced by `blueprint-cli resolve` |
| `generated/bundled/` | Dereferenced specs |
| `generated/clients/` | TypeScript clients produced by `blueprint-cli generate-ts-clients` |
| `generated/explorer/` | Rendered Explorer site |
| `generated/mock/` | The browser mock page, served and single-file |
| `generated/overlays/`, `generated/postman/`, `generated/schemas/` | Generated overlays, a Postman collection, exported JSON Schemas |

## What it is for

Two jobs, and the second matters more than it looks.

It is the shared fixture the tooling packages test against. It is also the only place the contract types are used *together*, by something that doesn't know which parts are load-bearing — which is a different test, and a harder one to pass.

Unit tests exercise one seam at a time and keep passing. Building something real against the whole set finds what they cannot. Writing the browser demo page in `mock/` surfaced, among other things:

- a cross-domain subscription this contract set declares, which had never once run: the step was written in a shape the engine does not accept, and the schema permits that shape
- an event emitted with an empty payload, so even a correctly written subscriber had nothing to act on
- a field annotated `x-derived` whose expression was neither a derivation nor valid CEL — it only evaluated because the evaluator falls through to JavaScript
- a package export documented in three places and absent from `package.json`

Most of them share a shape: a contract declares something, code does the same job by hand, and both sides work while disagreeing. That is the failure this whole project exists to prevent, and nothing catches it except using the contracts end to end.

So when you add a feature to a tooling package, adding a contract here that exercises it is worth more than another unit test.

## What each contract type exercises

### OpenAPI specs

**[`contracts/domains/intake/intake-openapi.yaml`](contracts/domains/intake/intake-openapi.yaml)**
- State machine RPC endpoint injection (`open`, `submit`, `withdraw`, `approve` actions)
- `x-enum-source: "slaTypes[].id"` — SLA type code field populated from SLA types file
- `x-enum-source: { source: "states[].id", machine: "Application" }` — status field populated from state machine
- `x-relationship` expand-style relationship injection
- Composition endpoint injection (from `intake-compositions.yaml`)
- State overlay customization: `county_code` field added to `ApplicationWritable`

**[`contracts/domains/eligibility/eligibility-openapi.yaml`](contracts/domains/eligibility/eligibility-openapi.yaml)**
- Rules endpoint injection (two POST endpoints added from `eligibility-rules.yaml`)
- `x-relationship` expand-style on determination fields
- Standard CRUD pattern (list, get, create, update, delete)

### State machine

**[`contracts/domains/intake/intake-state-machine.yaml`](contracts/domains/intake/intake-state-machine.yaml)**
- Multi-machine format (`machines[]` array with a single `Application` machine)
- Action steps: `set` (record timestamps) and `emit` (fire domain events)
- `x-event-type-prefix` injection — event types prefixed with `ca.` via state overlay
- SLA clock states (`running`, `stopped`, `paused`) on each lifecycle state

### SLA types

**[`contracts/domains/intake/intake-sla-types.yaml`](contracts/domains/intake/intake-sla-types.yaml)**
**[`contracts/domains/eligibility/eligibility-sla-types.yaml`](contracts/domains/eligibility/eligibility-sla-types.yaml)**
- SLA type definitions referenced via `x-enum-source: "slaTypes[].id"` in OpenAPI specs
- Multiple SLA types per domain (standard and expedited processing deadlines)

### Rules

**[`contracts/domains/eligibility/eligibility-rules.yaml`](contracts/domains/eligibility/eligibility-rules.yaml)**
- Two rulesets: `expeditedSnap` and `interviewProbes`
- Object and array input types (including nested array member fields)
- Fact-to-fact dependencies
- Endpoint generation: each ruleset with `endpoint:` produces a POST path injected into the eligibility OpenAPI spec

**[`contracts/domains/eligibility/eligibility-rules-examples.yaml`](contracts/domains/eligibility/eligibility-rules-examples.yaml)**
- Per-ruleset example inputs and expected outputs used for batch evaluation testing

### Annotations

**[`contracts/domains/intake/intake-annotations.yaml`](contracts/domains/intake/intake-annotations.yaml)**
**[`contracts/domains/eligibility/eligibility-annotations.yaml`](contracts/domains/eligibility/eligibility-annotations.yaml)**
- Field-level annotations with `reason`, `design`, and `policy` fields
- Policy citations linking fields to regulatory requirements

### Metrics

**[`contracts/domains/intake/intake-metrics.yaml`](contracts/domains/intake/intake-metrics.yaml)**
- Uses the `applications` MetricCollection value (extended from base via overlay)

**[`contracts/domains/eligibility/eligibility-metrics.yaml`](contracts/domains/eligibility/eligibility-metrics.yaml)**
- Uses the `determinations` MetricCollection value (extended from base via overlay)

### Compositions

**[`contracts/domains/intake/intake-compositions.yaml`](contracts/domains/intake/intake-compositions.yaml)**
- Composite view definition that generates an additional GET endpoint in the intake OpenAPI spec

### Overlays

**[`contracts/overlays/enums.yaml`](contracts/overlays/enums.yaml)**
- Extends the base `Domain` enum to add `intake` and `eligibility`
- Extends the base `MetricCollection` enum to add `applications` and `determinations`
- Uses `files:` (array/string form) rather than `file:` to target the base enums schema

**[`contracts/overlays/state-overlay.yaml`](contracts/overlays/state-overlay.yaml)**
- Config block: `x-casing`, `x-pagination`, `x-search`, `x-relationship`, `x-event-type-prefix`
- Action: adds a `county_code` field to `ApplicationWritable` — exercises state-specific schema extension

### Policies

**[`contracts/platform/platform-policies.yaml`](contracts/platform/platform-policies.yaml)**
- Platform-level eligibility policy definitions
- Exercises overlay targeting of policy files

### Shared schemas and components

**[`contracts/common/components/responses.yaml`](contracts/common/components/responses.yaml)**
**[`contracts/common/schemas/shared.yaml`](contracts/common/schemas/shared.yaml)**
- Common error responses and shared schema types referenced across domain specs

## Regenerating generated outputs

Generated outputs are committed to this repo as golden files. Regenerate them when contracts change or when a script is updated and the output diff is intentional.

```bash
# Regenerate resolved/ after changing contracts or overlays
node packages/blueprint-cli/scripts/resolve.js \
  --spec=packages/blueprint-harness/contracts \
  --overlay=packages/blueprint-harness/contracts/overlays \
  --out=packages/blueprint-harness/generated/resolved

# Regenerate clients/ after changing resolved/
node packages/blueprint-cli/scripts/generate-ts-clients.js \
  --spec=packages/blueprint-harness/generated/resolved \
  --out=packages/blueprint-harness/generated/clients
```

Review the git diff before committing — a golden update should match an intentional contract or script change.

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
