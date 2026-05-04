# Setup Guide

> **Status: Draft**

This guide walks through setting up a repository that consumes the Safety Net Blueprint packages.

## What each package provides

| Package | Description | CLIs |
|---|---|---|
| `@codeforamerica/safety-net-blueprint-contracts` | Base OpenAPI specs, overlay resolver, validation | `safety-net-resolve`, `safety-net-design-reference` |
| `@codeforamerica/safety-net-blueprint-mock-server` | Mock API server and Swagger UI for development | `safety-net-mock`, `safety-net-swagger` |
| `@codeforamerica/safety-net-blueprint-clients` | Postman collection and TypeScript client generation | — |

Install these packages as dependencies and point the CLIs at your resolved specs.

## Initial setup

### 1. Create the repository

```bash
mkdir <your-repo>
cd <your-repo>
npm init -y
```

### 2. Install dependencies

```bash
npm install @codeforamerica/safety-net-blueprint-contracts @codeforamerica/safety-net-blueprint-mock-server @codeforamerica/safety-net-blueprint-clients
```

### 3. Create directory structure

```
<your-repo>/
  overlays/           # Overlay files (organized however you like)
  resolved/           # Generated output (gitignored)
  .env                # Environment-specific values (gitignored)
  package.json
```

Add `resolved/` and `.env` to `.gitignore`:

```
resolved/
.env
```

### 4. Add npm scripts

```json
{
  "scripts": {
    "resolve": "safety-net-resolve --spec=./node_modules/@codeforamerica/safety-net-blueprint-contracts --overlay=./overlays --out=./resolved",
    "resolve:prod": "safety-net-resolve --spec=./node_modules/@codeforamerica/safety-net-blueprint-contracts --overlay=./overlays --out=./resolved --env=production --env-file=.env",
    "validate": "node ./node_modules/@codeforamerica/safety-net-blueprint-contracts/scripts/validate-openapi.js --spec=./resolved --skip-examples",
    "mock:start": "safety-net-mock --spec=./resolved",
    "swagger": "safety-net-swagger --spec=./resolved",
    "build": "npm run resolve && npm run validate"
  }
}
```

### 5. Pin the base specs version

Use an exact version in `package.json` to control when you pick up base spec changes:

```json
{
  "dependencies": {
    "@codeforamerica/safety-net-blueprint-contracts": "1.2.0"
  }
}
```

## Overlay authoring

Overlays modify the base specs without forking them. See the [Overlay Guide](overlay-guide.md) for overlay syntax, action types, target path expressions, file disambiguation, and global config options.

A working example is included in the base repo at [`packages/contracts/overlays/example/`](../../packages/contracts/overlays/example/). Use it as a starting point for your own overlay.

## CI pipeline

A typical CI pipeline resolves overlays, validates, and generates artifacts:

```yaml
# Example GitHub Actions workflow
name: Build and Validate

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci

      # Resolve overlays with production environment
      - name: Resolve specs
        run: npm run resolve:prod
        env:
          API_BASE_URL: ${{ vars.API_BASE_URL }}

      # Validate resolved specs
      - name: Validate
        run: npm run validate

      # Start mock server and run tests
      - name: Integration tests
        run: |
          npm run mock:start &
          sleep 3
          npm test
```

See [Resolve Pipeline Architecture](../architecture/resolve-pipeline.md) for how environment filtering and placeholder substitution work.

## Updating base specs

When a new version of `@codeforamerica/safety-net-blueprint-contracts` is released:

1. **Review the changelog** for breaking changes to schemas or file structure
2. **Update the dependency**: `npm install @codeforamerica/safety-net-blueprint-contracts@<new-version>`
3. **Run resolve**: `npm run resolve` — overlay actions that target paths that no longer exist will produce warnings
4. **Fix stale overlay targets**: update JSONPath expressions to match the new schema structure
5. **Validate**: `npm run validate` — confirm the resolved output is valid
6. **Run tests**: verify your integration tests still pass

Pinning to exact versions (not ranges) gives you control over when to adopt changes.

## Security considerations

- **Keep `.env` out of version control** — add it to `.gitignore`
- **Keep `resolved/` out of version control** — it's generated output and may contain substituted secrets
- **Use CI environment variables** for production secrets (API keys, auth issuer URLs) rather than committing them to `.env` files
- **Review overlay changes** — overlays can modify auth schemas, security schemes, and server URLs. Treat overlay changes with the same scrutiny as code changes.

## Contributing back

Some customizations may benefit all adopters. Consider proposing changes to the base specs when:

- A field is universally needed but missing from the base schema
- A pattern you've implemented via overlay would be cleaner as a base schema change
- You've identified a bug or inconsistency in the base specs

To contribute:

1. Open an issue describing the proposed change and why it benefits multiple adopters
2. If approved, submit a PR against the base `@codeforamerica/safety-net-blueprint-contracts` repo
3. Once merged, remove the corresponding overlay action — the change is now in the base
