# Proposal: State Customization Strategy

**Status:** Accepted

## Overview

This repository provides base OpenAPI specifications for safety net program APIs. States will customize these specs for their own implementations while staying aligned with the base models. This proposal defines how states can:

- Consume base specs without forking the repository
- Apply state-specific customizations via overlays
- Handle environment-specific configuration (dev/staging/production)
- Update to newer base versions on their own schedule
- Contribute improvements back to the base specs

**Sections:**

1. **[File Organization](#1-file-organization)** - Versioning conventions for APIs and components
2. **[Environment Configuration](#2-environment-configuration)** - Handling dev/staging/production differences
3. **[State Distribution & Overlays](#3-state-distribution--overlays)** - How states consume, customize, and contribute
4. **[Implementation Plan](#4-implementation-plan)** - What needs to change in existing tooling

> **Note:** This proposal was written for OpenAPI spec overlays. The [contract-driven architecture](../architecture/contract-driven-architecture.md) introduces additional contract artifacts (state machine YAML, rules YAML, metrics YAML, form definitions) that states will also need to customize. The overlay approach described here extends naturally to those artifact types — a future update will document how state overlays apply across all contract artifacts.

## Considerations

- States can adopt and maintain customizations with minimal overhead
- Base repo changes should not break state customizations (overlays target schema content, not file paths)
- States can adopt base specs without forking
- States can update to newer base versions on their own schedule
- States can keep sensitive configuration private
- Multiple API versions can coexist
- Contributing back to base is straightforward

### Constraints

- Must work with existing Spectral validation
- Overlays follow the OpenAPI Overlay Specification (1.0.0), with update actions using JSON Merge Patch semantics (RFC 7396)
- OpenAPI has no native support for build-time substitution (variables only work in server URLs at runtime), requiring a resolve CLI for CI pipelines

---

## 1. File Organization

Each API spec is a self-contained OpenAPI document: paths, parameters, and domain schemas all live in the same file. This makes versioning atomic — when you create `applications-v2.yaml`, it carries all its schemas with it. Across the entire file organization, tooling relies on naming conventions and content matching rather than folder structure — files can be reorganized without breaking downstream consumers or overlays.

Shared types that are stable across APIs (Address, Name, Email, PhoneNumber) stay in component files, organized by domain. These are evolved additively (new optional fields, expanded enums) rather than versioned independently — this is standard practice for shared API components. If an API spec ever needs to diverge from a shared type, it can inline its own version and stop referencing the shared one.

**Pattern:** Version suffix in filename (no suffix = v1 implicit). Versioning applies to API specs, not components.

```
openapi/
  applications.yaml              # v1 spec — paths + Application, HouseholdMember, etc.
  applications-examples.yaml     # v1 examples
  applications-v2.yaml           # v2 spec (breaking changes) — self-contained
  applications-examples-v2.yaml  # v2 examples
  persons.yaml                   # Same pattern: spec + examples per API
  persons-examples.yaml
  ...
  components/
    contact.yaml                 # Address, Email, PhoneNumber
    identity.yaml                # Name, SocialSecurityNumber
    common.yaml                  # Language, Program, Signature
    parameters.yaml              # Shared query parameters
    responses.yaml               # Shared error responses
    auth.yaml                    # BackendAuthContext, JwtClaims, RoleType, Role
    security-schemes.yaml        # OAuth2, API key definitions
```

**API spec conventions:**
- No suffix = version 1 (implicit), `-v2`, `-v3` etc. for breaking changes
- Include version in the info block (`info.version: "1.0.0"`) and base URL (`/v1/applications`)
- May include `info.x-api-id` (e.g., `x-api-id: workflow-tasks`) as a stable machine-readable identifier. Optional — only needed when the same schema name exists in multiple API specs, so overlays can disambiguate using `target-api`
- Domain schemas live in their API spec, not in separate component files
- Examples use `{name}-examples.yaml` naming (e.g., `applications-examples.yaml`), colocated with their spec in `openapi/`. Versioned examples follow the same suffix pattern (`applications-examples-v2.yaml`). This eliminates the dependency on a separate `examples/` folder — tooling discovers example files by naming convention, not folder structure, so the directory layout can change without breaking anything. Examples are kept separate from the spec to avoid bloating the API definition with verbose test data — complex schemas like Application can have large realistic examples — and because the mock server reads them independently for database seeding
- Backward-compatible changes (adding optional fields, expanding enums) update the spec in place — no version bump needed
- Breaking changes (renaming schemas, removing fields, changing types) create a new versioned spec file

**Shared component conventions:**
- Organized by domain (`contact.yaml`, `identity.yaml`, etc.) and referenced via `$ref` across API specs
- Evolved additively, not versioned independently — reorganizing component files does not break downstream overlays since overlays target schema content, not filenames
- If a shared component needs a breaking change, update the component and have any API specs that need the old shape inline their own version

**Other options considered:**

| Option | Pros | Cons |
|--------|------|------|
| Folder per version (`v1/applications.yaml`) | Groups all v1 together | Deep nesting, harder to compare versions |
| URL-only versioning | Simpler file structure | Can't maintain incompatible schemas |
| Independent component versioning (`identity-v2.yaml`) | Fine-grained | Schema name collisions across versions, overlay disambiguation complexity |

---

## 2. Environment Configuration

Environment-specific configuration requires build-time processing since OpenAPI has no native support for it. Two mechanisms are used:

1. **Placeholder substitution** (`${VAR}`) - Replace values from environment variables
2. **Section filtering** (`x-environments`) - Include/exclude YAML sections based on target environment

OpenAPI doesn't support substituting entire YAML sections at build time, so `x-environments` provides a way to mark which sections should be included for each environment.

**Example: Security schemes with both mechanisms**

```yaml
# components/security-schemes.yaml
oauth2:
  type: oauth2
  x-environments: [dev, staging, production]    # Only include in these environments
  flows:
    authorizationCode:
      authorizationUrl: '${IDP_AUTHORIZATION_URL}'  # Placeholder substitution
      tokenUrl: '${IDP_TOKEN_URL}'
      scopes:
        read: Read access
        write: Write access

apiKey:
  type: apiKey
  x-environments: [local, dev]    # Only include in local and dev
  in: header
  name: X-API-Key
```

At build time for `--env=production`:
- `oauth2` is included (production is in its `x-environments`)
- `apiKey` is excluded (production is not in its `x-environments`)
- `${IDP_AUTHORIZATION_URL}` and `${IDP_TOKEN_URL}` are substituted from environment variables

`x-environments` is optional. States that prefer simplicity can skip it entirely and include all security schemes in every environment, using `description` fields to document which environments support which auth methods. Placeholder substitution works independently.

**Other options considered:**

| Option | Pros | Cons |
|--------|------|------|
| `envsubst` for placeholders | Standard Unix tool; simple | Only substitutes strings, cannot filter YAML sections |
| Literal URLs in spec | No build step | Exposes all URLs |

---

## 3. State Distribution & Overlays

States consume base specs as an npm dependency and maintain their own repositories for customizations. This keeps sensitive configuration private, allows states to update on their own schedule, and avoids repo bloat from other states' configurations.

### Repository Structure

**This repository (public):** The `openapi/` directory structure is defined in [File Organization](#1-file-organization). The `packages/` directory provides the tooling states install:

- `schemas/` — `@safety-net-blueprint/schemas` — base specs, resolve CLI, design reference generator
- `mock-server/` — `@safety-net-blueprint/mock-server` — mock server, Swagger UI
- `tools/` — `@safety-net-blueprint/tools` — validation, client generation, Postman collection generation, test runner

Note: State-specific overlays will be removed from this repository and overlay authoring examples will be included in the state setup guide (see [4.9](#49-state-setup-guide)). Because the resolve CLI matches overlay targets by scanning base file contents (not by filename or directory structure), moving or renaming files in the base repository does not break state overlays. The only change that breaks an overlay is renaming a schema itself (e.g., `Person` → `Individual`), which is a real API change. The resolve CLI warns when overlay targets don't match any base schema, so states know immediately after updating. States should pin exact versions of the base schemas (e.g., `"@safety-net-blueprint/schemas": "1.2.0"` rather than `"^1.2.0"`) so updates are intentional.

**State repository (state-controlled, can be private):**
```
{state}-safety-net-blueprint/
  package.json              # @safety-net-blueprint/schemas as dependency
  overlays/
    schemas.yaml            # Schema customizations (Person, Application, etc.)
    auth.yaml               # Auth/role customizations
  resolved/                 # Output directory (gitignored)
```

States organize overlays however makes sense for them — by concern, by team, or even a single file. The resolve CLI matches actions to base files by JSONPath content, not by filename or directory structure.

### Overlay Conventions

- Each overlay file is a standard OpenAPI Overlay document (`overlay: 1.0.0`, `info`, `actions`)
- Actions use JSONPath targets (e.g., `$.components.schemas.Person.properties`) — the resolve CLI scans all base files to find where each target exists, so overlays are not coupled to the base repository's folder structure
- If a target exists in exactly one base file, it is applied automatically. Because domain schemas live in their API spec (not in separate component files), schema names are unique across files in practice.
- If a target exists in multiple base files, the resolver disambiguates using two optional action properties:
  - `target-api` — matches against the spec's `info.x-api-id` (e.g., `target-api: workflow-tasks`). Use when the same schema name exists in different API specs.
  - `target-version` — matches against the filename suffix convention (no suffix = v1, `-v2` = v2, etc.). If omitted, v1 is assumed. Use when the same schema name exists across API versions.
  - If neither is provided and the target matches multiple files, the resolver warns and skips the action.
- States can choose which API versions to adopt

### How States Use It

**Initial setup:**
```bash
mkdir {state}-safety-net-blueprint
cd {state}-safety-net-blueprint
npm init -y

# Install base schemas as dependency
npm install @safety-net-blueprint/schemas
```

The `safety-net-resolve` CLI handles both overlay customizations and environment-specific resolution in a single command:

1. **Apply overlays** — state customizations on top of base specs
2. **Filter by x-environments** — remove sections not available for target environment
3. **Substitute placeholders** — replace `${VAR}` with values from environment variables
4. **Write resolved specs** — output to `./resolved`

**package.json:**
```json
{
  "name": "{state}-safety-net-blueprint",
  "scripts": {
    "resolve:dev": "safety-net-resolve --base=./node_modules/@safety-net/contracts --env=dev --overlays=./overlays --out=./resolved",
    "resolve:prod": "safety-net-resolve --base=./node_modules/@safety-net/contracts --env=production --overlays=./overlays --out=./resolved",
    "validate": "safety-net-validate --specs ./resolved",
    "mock:start": "safety-net-mock --specs ./resolved",
    "swagger": "safety-net-swagger --specs ./resolved",
    "clients:typescript": "safety-net-clients --specs ./resolved --out ./clients",
    "postman": "safety-net-postman --specs ./resolved --out ./postman",
    "test": "safety-net-test --specs ./resolved",
    "design:reference": "safety-net-design-reference --specs ./resolved --out ./docs"
  },
  "dependencies": {
    "@safety-net-blueprint/schemas": "1.0.0"
  },
  "devDependencies": {
    "@safety-net-blueprint/mock-server": "^1.0.0",
    "@safety-net-blueprint/tools": "^1.0.0"
  }
}
```

This example shows the full set of available scripts. Downstream projects (backend, frontend, QA) don't need all of them — they install only the packages they need and point at the resolved output. For example, a frontend project might only install `@safety-net-blueprint/tools` for client generation and `@safety-net-blueprint/mock-server` for local development.

**Getting updates:**
```bash
# Update to latest base schemas
npm update @safety-net-blueprint/schemas

# Or update to specific version
npm install @safety-net-blueprint/schemas@1.2.0

# Re-resolve
npm run resolve:prod
```

**Future consideration:** For non-JS teams, a git submodule-based approach could be documented as an alternative.

### Contributing Back

1. State identifies improvement to base model (new field, bug fix, etc.)
2. State clones `safety-net-blueprint` repo separately
3. State makes changes to base specs
4. State opens PR to `safety-net-blueprint` repository
5. PR is reviewed and merged
6. State updates their npm dependency to get the change

**Other options considered:**

| Option | Pros | Cons |
|--------|------|------|
| Single monorepo (all states in one repo) | Simple | Bloated, exposes configs |
| Fork per state | Full control | Hard to pull updates |

---

## 4. Implementation Plan

This section maps the proposal to concrete changes in existing tooling. Items are ordered by dependency — later items build on earlier ones.

### 4.1 Consolidate domain schemas into API specs

Domain schemas currently live in separate component files (`components/person.yaml`, `components/application.yaml`, etc.) and are referenced by API specs via `$ref`. This creates cross-file dependencies that complicate versioning and overlay targeting.

**Changes:**
- Move domain schemas into the `components/schemas` section of their API spec file (e.g., Person, DemographicInfo, CitizenshipInfo move into `openapi/persons.yaml`)
- Reorganize shared component files by domain: split `common.yaml` into `contact.yaml` (Address, Email, PhoneNumber), `identity.yaml` (Name, SocialSecurityNumber), and `common.yaml` (Language, Program, Signature). Rename `common-parameters.yaml` → `parameters.yaml` and `common-responses.yaml` → `responses.yaml`.
- Keep auth schemas in `components/auth.yaml`
- Update all `$ref` paths — intra-file references become `#/components/schemas/Person`, cross-API references become `./persons.yaml#/components/schemas/Person`
- Remove the now-empty component files (`components/person.yaml`, `components/application.yaml`, `components/income.yaml`, etc.)
- Move example files from `openapi/examples/{name}.yaml` to `openapi/{name}-examples.yaml` to colocate them with their spec
- Update the API generator (`generate-api.js`) to produce two files instead of three: the API spec (`openapi/{name}.yaml`) with schemas inline under `components/schemas`, and an examples file (`openapi/{name}-examples.yaml`). The generator no longer creates a separate component file under `components/`. If a schema later turns out to be useful across multiple APIs, the author can extract it into `components/` at that point.
- Add `--version` flag to the generator for creating a new version of an existing API (e.g., `npm run api:new -- --name applications --version 2`). This copies the current spec and examples as a starting point (`applications.yaml` → `applications-v2.yaml`, `applications-examples.yaml` → `applications-examples-v2.yaml`), updates `info.version` and the base URL, and prints a reminder to make the breaking changes.
- Update the mock server seeder and validation scripts to find examples using the `{name}-examples.yaml` naming convention

### 4.2 Resolve CLI: external overlay directories

The current `resolve-overlay.js` assumes overlays live inside this repository at `openapi/overlays/{state}/modifications.yaml`. For the npm distribution model, the resolve CLI needs to work from a state's own repository.

**Changes:**
- Accept `--base` flag pointing to the directory of base specs (e.g., `--base=./node_modules/@safety-net/contracts`). Required — no default, since the tooling runs in different contexts (npm dependency, git submodule, local checkout)
- Accept `--overlays=./overlays` flag pointing to the state's overlay directory
- Accept `--out=./resolved` flag for the output directory

### 4.3 Overlay file discovery and version-aware resolution

The current convention uses a single `modifications.yaml` per state inside this repository. The external model allows states to organize overlays however they want — one file or many.

**Changes:**
- Update the resolve script to discover all `.yaml` files in the `--overlays` directory (any name, any nesting)
- Each file must be a valid OpenAPI Overlay document (`overlay: 1.0.0`)
- The existing two-pass target resolution is retained: actions use JSONPath targets, and the resolver scans all base files to find where each target exists
- Add disambiguation for multi-file matches: when a target exists in multiple base files, the resolver checks the action for `target-api` (matched against the spec's `info.x-api-id`) and `target-version` (matched against the filename suffix convention, default: v1). If neither is provided, warn and skip.

### 4.4 Environment configuration: `x-environments` filtering

No environment filtering exists today.

**Changes:**
- Add `--env` flag to the resolve CLI (e.g., `--env=production`)
- After applying overlays, walk the resolved YAML tree and remove nodes whose `x-environments` array does not include the target environment
- Strip `x-environments` extensions from surviving nodes so the output is clean OpenAPI
- When `--env` is omitted, skip filtering (all sections included)

### 4.5 Environment configuration: placeholder substitution

No placeholder substitution exists today.

**Changes:**
- After environment filtering, scan string values for `${VAR}` patterns and replace with `process.env[VAR]`
- Warn on unresolved placeholders (referenced variable not set)
- Processing order: apply overlays → filter by `x-environments` → substitute `${VAR}` → write output

### 4.6 Package CLIs as bin entries

The resolve, validate, and mock server scripts are currently internal to each package. States need to run them via `npx` from their own repositories.

**Changes:**
- Add `bin` entries to each package's `package.json`:
  - `@safety-net-blueprint/schemas` → `safety-net-resolve`, `safety-net-design-reference`
  - `@safety-net-blueprint/tools` → `safety-net-validate`, `safety-net-clients`, `safety-net-postman`, `safety-net-test`
  - `@safety-net-blueprint/mock-server` → `safety-net-mock`, `safety-net-swagger`

**Security note:** CLI bin entries run with the installing user's permissions and have access to all environment variables. The resolve CLI intentionally reads `process.env` for placeholder substitution, so resolved output files may contain sensitive values (IDP URLs, API keys). States should `.gitignore` their `resolved/` directory and limit CI environment variables to what's needed.

### 4.7 Parameterize all tooling to accept `--specs`

All tooling currently reads from hardcoded paths relative to their packages. Each CLI must accept a `--specs` flag so it can operate on resolved specs in any directory. The `--specs` flag is required — there is no default, since the tooling runs in different contexts (this repo, state repos, CI).

**Changes:**
- Mock server: accept `--specs` to load specs from an arbitrary directory
- Swagger UI: accept `--specs` to serve interactive API docs
- Validation: accept `--specs` to validate specs from an arbitrary directory
- Postman generator: accept `--specs` to generate collections from resolved specs
- Test runner: accept `--specs` to run integration tests against resolved specs
- Design reference: accept `--specs` to generate HTML from a single set of specs. The current script discovers state overlays by scanning `openapi/overlays/`, loads each overlay, and generates a multi-state comparison view. Remove the overlay discovery, loading, and application logic (`discoverOverlays`, `loadOverlay`, `applyOverlayToSchemas`) and simplify the HTML output to render a single set of specs rather than a multi-state comparison

### 4.8 Remove state overlays from this repository

Once the external overlay model is in place, state-specific overlays no longer belong in this repo.

**Changes:**
- Remove all state overlay directories under `openapi/overlays/`
- Remove the `validate:all-states` script and its CI step (states validate their own resolved specs in their own CI pipelines)
- Add overlay authoring examples to the state setup guide (see 4.9)

### 4.9 State setup guide

Create a guide for states adopting the base specs. This should cover initial setup, what each package provides, overlay authoring, and CI integration.

**Contents:**

- **What each package provides:** packages, CLIs, and what each is used for
- **Initial setup:** repository creation, `npm init`, installing dependencies, directory structure
- **Overlay authoring:** overlay format, JSONPath targets, examples for common customizations (adding fields, replacing enums, replacing entire schemas)
- **Environment configuration:** when to use `x-environments` vs placeholder substitution, `.env` file patterns
- **CI pipeline:** resolve → validate → generate clients, `.gitignore` for `resolved/` output
- **Updating base specs:** pinning versions, running resolve after update to surface stale overlay targets, re-validating
- **Security:** environment variable handling, keeping resolved output out of version control, secrets in CI
- **Contributing back:** when to propose changes to the base specs vs keeping them as state overlays
