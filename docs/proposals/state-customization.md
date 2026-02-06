# Proposal: State Customization Strategy

**Status:** Draft

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

## Considerations

- Clear file naming conventions
- Flat file structure preferred (avoid deep nesting)
- States can adopt base specs without forking
- States can update to newer base versions on their own schedule
- States can keep sensitive configuration private
- Multiple API versions can coexist
- Contributing back to base is straightforward

### Constraints

- Must work with existing Spectral validation
- Overlays use JSON Merge Patch format (RFC 7396)
- OpenAPI has no native support for build-time substitution (variables only work in server URLs at runtime), requiring a resolve CLI for CI pipelines

---

## 1. File Organization

**Pattern:** Version suffix in filename (no suffix = v1 implicit). Applies to both API specs and component files.

```
openapi/
  applications.yaml         # Version 1 (implicit, current)
  applications-v2.yaml      # Version 2 (when breaking changes needed)
  households.yaml
  persons.yaml
  components/
    contact.yaml            # Address, Email, PhoneNumber
    identity.yaml           # Name, SocialSecurityNumber
    identity-v2.yaml        # Breaking changes to identity schemas
    auth.yaml               # BackendAuthContext, JwtClaims, RoleType, Role
    security-schemes.yaml   # OAuth2, API key definitions
    common.yaml             # Language, Program, Signature
    common-parameters.yaml
    common-responses.yaml
```

**Conventions:**
- No suffix = version 1 (implicit)
- `-v2`, `-v3` etc. for breaking changes
- API specs include version in the info block (`info.version: "1.0.0"`) and base URL (`/v1/applications`)

**Other options considered:**

| Option | Pros | Cons |
|--------|------|------|
| Folder per version (`v1/applications.yaml`) | Groups all v1 together | Deep nesting, harder to compare versions |
| URL-only versioning | Simpler file structure | Can't maintain incompatible schemas |

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

**This repository (public):**
```
safety-net-apis/
  openapi/
    applications.yaml
    households.yaml
    persons.yaml
    components/
      contact.yaml
      identity.yaml
      auth.yaml
      security-schemes.yaml
  packages/
    schemas/                # @safety-net-apis/schemas - base specs + resolve CLI
    mock-server/            # @safety-net-apis/mock-server - mock server CLI
    tools/                  # @safety-net-apis/tools - validation, client generation
```

Note: State-specific overlays will be removed from this repository and examples of how to construct overlays will be added to the project documentation. A tradeoff of this approach is overlay fragility: overlays target specific JSONPaths (e.g., `$.Person.properties.program.enum`), so a base spec restructure — moving a property, renaming a schema, or refactoring component files — can break state overlays even when the API itself hasn't changed. The resolve script already warns when overlay targets don't exist in the base spec, but states won't know an update will break their overlays until they run it. To mitigate this, states should pin exact versions of the base schemas (e.g., `"@safety-net-apis/schemas": "1.2.0"` rather than `"^1.2.0"`) so updates are intentional. After updating, the resolve step surfaces any stale targets immediately. Release notes should flag structural changes (renamed schemas, moved paths) so states can assess impact before upgrading.

**State repository (state-controlled, can be private):**
```
california-safety-net-apis/
  package.json              # @safety-net-apis/schemas as dependency
  overlays/
    applications.yaml       # State-specific schema changes
    components/
      person.yaml           # State-specific component changes
  resolved/                 # Output directory
```

### Overlay Conventions

- Overlay folder structure must mirror base structure (e.g., `overlays/components/person.yaml` → `openapi/components/person.yaml`)
- Overlay filename must match base filename exactly so tooling can auto-resolve *(change from current: existing overlays use different naming)*
- Only create overlays for files that need customization
- State can choose which API versions to adopt

### How States Use It

**Initial setup:**
```bash
mkdir california-safety-net-apis
cd california-safety-net-apis
npm init -y

# Install base schemas as dependency
npm install @safety-net-apis/schemas
```

**package.json:**
```json
{
  "name": "california-safety-net-apis",
  "scripts": {
    "resolve:dev": "safety-net-resolve --env=dev --overlays=./overlays --out=./resolved",
    "resolve:prod": "safety-net-resolve --env=production --overlays=./overlays --out=./resolved",
    "validate": "safety-net-validate --specs ./resolved",
    "mock:start": "safety-net-mock --specs ./resolved",
    "clients:generate": "safety-net-clients --specs ./resolved --out ./clients"
  },
  "dependencies": {
    "@safety-net-apis/schemas": "1.0.0"
  },
  "devDependencies": {
    "@safety-net-apis/mock-server": "^1.0.0",
    "@safety-net-apis/tools": "^1.0.0"
  }
}
```

The `safety-net-resolve` CLI handles both overlay customizations and environment-specific resolution in a single command:

1. **Apply overlays** - State customizations on top of base specs
2. **Filter by x-environments** - Remove sections not available for target environment
3. **Substitute placeholders** - Replace `${VAR}` with values from environment variables
4. **Write resolved specs** - Output to `./resolved`

**Getting updates:**
```bash
# Update to latest base schemas
npm update @safety-net-apis/schemas

# Or update to specific version
npm install @safety-net-apis/schemas@1.2.0

# Re-resolve
npm run resolve:prod
```

**Future consideration:** For non-JS teams, a git submodule-based approach could be documented as an alternative.

### Contributing Back

1. State identifies improvement to base model (new field, bug fix, etc.)
2. State clones `safety-net-apis` repo separately
3. State makes changes to base specs
4. State opens PR to `safety-net-apis` repository
5. PR is reviewed and merged
6. State updates their npm dependency to get the change

**Other options considered:**

| Option | Pros | Cons |
|--------|------|------|
| Single monorepo (all states in one repo) | Simple | Bloated, exposes configs |
| Fork per state | Full control | Hard to pull updates |


