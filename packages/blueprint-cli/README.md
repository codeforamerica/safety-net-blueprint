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
  --spec ./src \
  --overlay ./overlays/config.yaml \
  --out ./resolved
```

Overlays let you customize base contracts without forking them — add fields, change descriptions, restrict visibility, or set domain-specific defaults. See the [Overlay Guide](https://github.com/codeforamerica/safety-net-blueprint/blob/main/docs/guides/overlay-guide.md).

### `blueprint-validate`

Runs all validators against a resolved contracts directory in sequence:

1. **OpenAPI validation** — syntax correctness, design pattern conformance (required fields, list response shapes, shared error `$ref`s, foreign key annotations)
2. **Fragment `$ref` validation** — checks that all `$ref` pointers resolve
3. **State machine validation** — validates state machine definitions and cross-artifact consistency (emit types matching event catalog entries, guard references, actor roles)
4. **Annotation validation** — validates field annotation files against their referenced schemas and policy registry

```bash
npx blueprint-validate --resolved ./resolved
```

### `blueprint-generate-ts-clients`

Generates typed TypeScript clients from resolved OpenAPI specs using `@hey-api/openapi-ts`. Produces per-domain SDK modules with full type coverage.

```bash
npx blueprint-generate-ts-clients --spec ./resolved --out ./clients
```

### `blueprint-generate-postman-collection`

Generates a Postman collection from resolved specs for use in API testing and contract verification.

```bash
npx blueprint-generate-postman-collection --spec ./resolved --out ./postman
```

## Changelog

See [CHANGELOG.md](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/blueprint-cli/CHANGELOG.md) for release history.

## Documentation

See the [Blueprint documentation](https://github.com/codeforamerica/safety-net-blueprint) for full guides and reference.

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
