# Package Generation & Publishing

> **Status: Draft**

This guide covers how state-specific client packages are built from resolved OpenAPI specs.

## Overview

The `@safety-net/clients` package generates state-specific TypeScript client packages containing:

- TypeScript SDK with typed functions for each API domain
- Zod schemas for runtime validation
- Resolved OpenAPI specs (YAML)
- Extracted JSON schemas for each component

## Build Process

The `build-state-package.js` script performs these steps:

### 1. Resolve Overlay

Merges base specs with state-specific modifications from `openapi/overlays/{state}/modifications.yaml`.

### 2. Generate Domain Clients

For each resolved spec:

- Bundles and dereferences the spec using `@apidevtools/swagger-cli`
- Generates TypeScript SDK via `@hey-api/openapi-ts` with:
  - Axios HTTP client
  - Zod validation schemas
  - SDK functions with automatic request/response validation

### 3. Copy OpenAPI Specs

Includes resolved YAML specs in the `openapi/` directory of the package.

### 4. Extract JSON Schemas

Pulls component schemas from each domain into `json-schema/{domain}/` as individual JSON files. Useful for consumers who need raw JSON Schema for validation tooling.

### 5. Create Exports

Generates `index.ts` that re-exports all domain modules and search helpers.

### 6. Generate package.json

Interpolates state name and version into the template at `packages/clients/templates/package.template.json`.

### 7. Compile TypeScript

Compiles to JavaScript in `dist/` with declaration files for TypeScript consumers.

## Local Development

Build a package locally for testing:

```bash
node packages/clients/scripts/build-state-package.js --state=<state> --version=0.0.0-local
```

Output is in `packages/clients/dist-packages/<state>/`.

### Testing Locally

```bash
cd packages/clients/dist-packages/<state>

# Option 1: npm link
npm link
cd /path/to/your/project
npm link <package-name>

# Option 2: npm pack
npm pack
cd /path/to/your/project
npm install /path/to/<package-name>-0.0.0-local.tgz
```

The package name is defined in `packages/clients/templates/package.template.json`.

## Publishing

### Automated Publishing (CI/CD)

Packages are published automatically when a version tag is pushed:

```bash
git tag v1.2.3
git push origin v1.2.3
```

The GitHub Actions workflow (`.github/workflows/publish-packages.yml`):

1. Triggers on `v*` tags
2. Builds packages for all states in the matrix
3. Extracts version from tag (e.g., `v1.2.3` → `1.2.3`)
4. Publishes to npmjs.org

### Manual Publishing

If you need to publish manually (not recommended for production):

```bash
# Build the package
node packages/clients/scripts/build-state-package.js --state=<state> --version=1.2.3

# Publish
cd packages/clients/dist-packages/<state>
npm publish --access public
```

Requires npm authentication with write access to the package scope.

## Authentication Strategy

Publishing uses two complementary authentication mechanisms:

### NPM_TOKEN

A classic npm automation token stored as a GitHub repository secret. Provides write access to the package scope on npmjs.org.

To create a new token:

1. Log in to npmjs.org
2. Go to Access Tokens → Generate New Token → Classic Token
3. Select "Automation" type
4. Add the token as `NPM_TOKEN` in GitHub repository secrets

### Provenance

Packages are published with npm provenance enabled (`provenance: true` in `publishConfig`). Combined with the workflow's `id-token: write` permission, this uses GitHub Actions OIDC to cryptographically link each package to:

- The specific source commit
- The build workflow that produced it
- The repository it was built from

Consumers can verify on npmjs.org that a package was built from this repository's CI/CD pipeline, not from an arbitrary developer's machine.

## Package Contents

The generated package includes:

```
<state>/
├── dist/                    # Compiled JavaScript + declaration files
│   ├── index.js
│   ├── index.d.ts
│   ├── search-helpers.js
│   └── {domain}/            # Per-domain SDK, types, Zod schemas
├── src/                     # TypeScript source (for reference)
├── openapi/                 # Resolved OpenAPI specs (YAML)
│   └── {domain}.yaml
└── json-schema/             # Extracted JSON schemas
    └── {domain}/
        ├── {Resource}.json
        └── ...
```

## Adding a New State

1. Create the state overlay (see [State Overlays Guide](../guides/state-overlays.md))
2. Add the state to the workflow matrix in `.github/workflows/publish-packages.yml`:

```yaml
strategy:
  matrix:
    state: [california, <state>, newstate]
```

3. Test locally:

```bash
node packages/clients/scripts/build-state-package.js --state=newstate --version=0.0.0-test
```

4. Push a version tag to publish all states.

## Troubleshooting

### Build Fails: "No resolved spec files found"

The overlay wasn't resolved. Check that:
- The state exists in `packages/schemas/openapi/overlays/{state}/`
- The overlay file is valid YAML

### Publish Fails: 403 Forbidden

The NPM_TOKEN doesn't have write access to the package scope, or has expired.

### Publish Fails: Provenance Error

Ensure the workflow has `id-token: write` permission and is running on `ubuntu-latest`.

### TypeScript Compilation Warnings

The build may show type warnings from generated code. These are typically in `@hey-api/openapi-ts` output and don't prevent the build from completing. The script checks if `dist/index.js` was created despite warnings.
