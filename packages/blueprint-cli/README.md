# @codeforamerica/blueprint-cli

> CLI tooling for the Blueprint framework — validate, resolve, scaffold, and generate artifacts across all contract types

[![npm version](https://img.shields.io/npm/v/@codeforamerica/blueprint-cli.svg)](https://www.npmjs.com/package/@codeforamerica/blueprint-cli)
[![license](https://img.shields.io/npm/l/@codeforamerica/blueprint-cli.svg)](https://github.com/codeforamerica/safety-net-blueprint/blob/main/LICENSE)

> **Pre-release:** This package is at `0.x`. Until `1.0.0`, minor versions may include breaking changes. Pin your version if stability matters.

## Installation

```bash
npm install --save-dev @codeforamerica/blueprint-cli
```

## Typical Workflow

### Building a new domain

1. [Scaffold](#blueprint-scaffold-api) a new spec with CRUD paths and schema variants
2. [Add resources](#blueprint-add-api-resource) to the domain as needed
3. [Resolve](#blueprint-resolve) overlays against base specs and generate RPC endpoints from state machines
4. [Validate](#blueprint-validate) the resolved output
5. [Generate TypeScript clients](#blueprint-generate-ts-clients) and/or a [Postman collection](#blueprint-generate-postman-collection)

For the full domain authoring workflow — including state machines, annotations, overlays, and compositions — see the [New Domain Builder Guide](https://github.com/codeforamerica/safety-net-blueprint/blob/main/docs/getting-started/new-domain-builders.md).

### Adopting the Safety Net Contracts

1. Author an overlay file to customize the base contracts for your context — see the [Overlay Guide](https://github.com/codeforamerica/safety-net-blueprint/blob/main/docs/guides/overlay-guide.md)
2. [Resolve](#blueprint-resolve) the base contracts with your overlay
3. [Validate](#blueprint-validate) the resolved output
4. [Generate TypeScript clients](#blueprint-generate-ts-clients) and/or a [Postman collection](#blueprint-generate-postman-collection)

## Commands

All commands are available as bin scripts. Run them via npm scripts in your `package.json` or directly with `npx`.

### `blueprint-scaffold-api`

Scaffolds a new OpenAPI spec with CRUD paths, standard schema variants (create/update/list response), and shared component `$ref`s pre-wired. Generates the full file structure for a new domain.

```bash
npx blueprint-scaffold-api \
  --name "permits" \
  --domain "permits" \
  --resource "Permit" \
  --out ./src/domains/permits
```

`--name` is the spec file name; `--domain` sets the `x-domain` field in the spec and defaults to `--name` if omitted.

### `blueprint-add-api-resource`

Adds a new resource to an existing domain spec — generates the paths, schema variants, and operation IDs following Blueprint conventions.

```bash
npx blueprint-add-api-resource --name "permits" --resource "Inspection" --out ./src/domains/permits
```

### `blueprint-resolve`

Merges base OpenAPI specs with overlay files and generates RPC endpoint definitions from state machines. The primary step before running the mock server, generating clients, or building the explorer.

```bash
npx blueprint-resolve \
  --spec=./src \
  --overlay=./overlays/config.yaml \
  --out=./resolved
```

Overlays let you customize base contracts without forking them — add fields, change descriptions, restrict visibility, or set domain-specific defaults. See the [Overlay Guide](https://github.com/codeforamerica/safety-net-blueprint/blob/main/docs/guides/overlay-guide.md).

### `blueprint-validate`

Runs all validators against a resolved contracts directory in sequence:

1. **OpenAPI validation** — syntax correctness, design pattern conformance (required fields, list response shapes, shared error `$ref`s, foreign key annotations)
2. **Fragment `$ref` validation** — checks that all `$ref` pointers resolve
3. **State machine validation** — validates state machine definitions and cross-artifact consistency (emit types matching event catalog entries, guard references, actor roles)
4. **Annotation validation** — validates field annotation files against their referenced schemas and policy registry
5. **Rules validation** — validates rules contracts, including cycle detection, unreachable node detection, and CEL expression syntax

```bash
npx blueprint-validate --resolved=./resolved
```

### `blueprint-generate-ts-clients`

Generates typed TypeScript clients from resolved OpenAPI specs using `@hey-api/openapi-ts`. Produces per-domain SDK modules with full type coverage.

```bash
npx blueprint-generate-ts-clients --spec=./resolved --out=./clients
```

### `blueprint-generate-postman-collection`

Generates a Postman collection from resolved specs for use in API testing and contract verification.

```bash
npx blueprint-generate-postman-collection --spec=./resolved --out=./postman
```

### `blueprint-export-schemas`

Exports component schemas from resolved OpenAPI specs as standalone JSON Schema files. Useful when downstream tooling — form renderers, validators, non-TypeScript clients — needs JSON Schema but not the full OpenAPI spec.

```bash
npx blueprint-export-schemas --spec=./resolved --out=./schemas
```

Output is organized by domain:

```
schemas/
  intake/
    Application.json
    HouseholdMember.json
    ...
```

The domain directory name is taken from `info.x-domain` in each spec, falling back to the filename slug (e.g. `intake` from `intake-openapi.yaml`).

### `blueprint-evaluate`

Evaluates rules from the command line. Takes a compiled graph (`*-graph.yaml`), a rules contract (`*-rules.yaml`, compiled on the fly), or a rules examples file (`*-rules-examples.yaml`) to run every ruleset and example in batch. Results are returned as JSON.

```bash
npx blueprint-evaluate --spec=./resolved/eligibility-rules.yaml --input=./inputs.json
```

Inputs may be partial — each fact reports whether it resolved, fell back to a declared default, or is still waiting on specific input paths.

### `blueprint-build-explorer`

Builds the Blueprint Explorer static site from a resolved contracts directory — context map, sequence diagrams, data dictionaries, state machine docs, rules docs, event catalog, and API reference.

```bash
npx blueprint-build-explorer --spec=./resolved --out=./explorer
```

Pass `--only=<tool>` to rebuild a single section, and `--clients=<dir>` to include the client reference generated by `blueprint-generate-ts-clients`.

### `blueprint-bundle-contracts`

Writes a whole contract set to one JSON file, for a browser to boot the mock
server from — or for `blueprint-mock --spec=contracts.json` to read without
walking a directory.

```bash
npx blueprint-bundle-contracts --spec=./resolved --out=./contracts.json
```

Validates the set first and refuses to write a broken one unless
`--skip-validation` is passed. `$ref`s are left intact: they name other
documents in the same set, so the set is already complete, and the mock
resolves them against it. Inlining them would take the safety-net contracts
from 0.67 MB to 3.95 MB.

`--domain=<name>` bundles one domain and what it needs — the named domains plus
`platform` plus the transitive closure of their `$ref`s, so the result is
self-contained. A plain filter would produce a file that parses and then cannot
follow a ref at runtime.

```bash
npx blueprint-bundle-contracts --spec=./resolved --domain=intake --out=./intake.json
```

| | documents | size |
|---|---|---|
| every domain | 73 | 0.67 MB |
| `--domain=intake` | 25 | 0.42 MB |
| `--domain=scheduling` | 12 | 0.10 MB |

### `blueprint-build-mock-page`

Builds a page that runs the mock server, with no server.

```bash
npx blueprint-build-mock-page --spec=./resolved --out=./mock-page
```

Writes two things, because serving a page and opening one have different
constraints:

| Output | For |
|---|---|
| `index.html` + `mock.js` + `contracts.json` | Serving over http(s) — GitHub Pages, S3, `npx serve` |
| `standalone.html` | Opening from `file://`, where fetching a sibling file is blocked as cross-origin |

The page reads the route table the mock builds rather than naming paths, so it
demonstrates whatever contract set it is given and disables what the set does
not declare. Event injection and document upload need a contract declaring
`publishEvent` and `uploadDocument`; without them those controls say so rather
than failing when clicked.

Takes `--domain` too, passed through to the bundler.

## Changelog

See [CHANGELOG.md](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/blueprint-cli/CHANGELOG.md) for release history.

## Documentation

See the [Blueprint documentation](https://github.com/codeforamerica/safety-net-blueprint) for full guides and reference.

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
