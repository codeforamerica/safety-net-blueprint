# ADR: Authentication and Authorization Patterns

**Status:** Proposed

**Date:** 2026-01-26

**Deciders:** Development Team

---

## Context

The Safety Net OpenAPI toolkit needs authentication and authorization patterns that can be implemented by adopters. The patterns must support multiple user types (applicants, case workers, supervisors, admins) with different levels of access to sensitive data.

### Requirements

- Support multiple user types with different permissions
- Multi-tenant (multiple organizational units sharing infrastructure)
- Flexible data scoping for staff (by county, district, region, program, or combinations)
- Data scoping by user for applicants (self-service access to own data)
- Field-level access control for sensitive data (SSN)
- Audit trail for compliance
- Integrate with standard Identity Providers (IdP)
- Patterns must be implementable without specific vendor lock-in

### Constraints

- Must work with existing OpenAPI specifications
- Should not require runtime calls to authorization service on every API request
- Must support future domains (Case Management, Workflow) without redesign
- Applicants and staff have fundamentally different access patterns

---

## Proposed Approach

We propose a **three-layer architecture** with:

1. **Identity Provider (IdP)** for authentication
2. **User Service** for authorization context (roles, permissions, organizational scope)
3. **JWT-based authorization** with permissions embedded in tokens

```
┌──────────────┐         ┌─────────────────────────────────────────┐
│   Frontend   │────────▶│         Identity Provider (IdP)         │
│              │  login  │  Auth0, Okta, Keycloak, Cognito, etc.  │
│  - Stores JWT│◀────────│  - Authenticates users (login, MFA)    │
│  - Calls APIs│   JWT   │  - Calls User Service to enrich tokens │
└──────┬───────┘         └──────────────────┬──────────────────────┘
       │                                    │
       │ GET /users/me                      │ GET /token/claims/{sub}
       │ (for ui + preferences)             │ (at login time)
       │                                    ▼
       │                 ┌─────────────────────────────────────────┐
       │                 │              User Service               │
       │                 │  - Stores role and scope assignments   │
       │                 │  - Provides claims for JWT enrichment  │
       │                 │  - Manages user lifecycle              │
       │                 │  - Links to domain entities            │
       │                 └─────────────────────────────────────────┘
       │
       │ Authorization: Bearer <jwt>
       ▼
┌─────────────────────────────────────────────────────────────────┐
│                          Domain APIs                            │
│  - Validate JWT signature                                       │
│  - Read permissions from claims                                 │
│  - Filter data by organizational scope or user                 │
│  - No runtime calls to User Service                            │
└─────────────────────────────────────────────────────────────────┘
```

**Note:** In some architectures, a BFF (Backend-for-Frontend) or API gateway sits between the frontend and other services. The BFF handles IdP communication, token management, and may enrich tokens for the frontend. See [BFF/Gateway Pattern](#bffgateway-pattern) for details.

### Key Design Choices

| Recommendation | Rationale |
|----------|-----------|
| Separate IdP from User Service | IdP handles login/MFA; User Service handles domain-specific roles |
| Embed permissions in JWT | Avoid runtime calls to User Service on every API request |
| User Service as cross-cutting concern | Not part of Case Management; needed before any domain can be implemented |
| User links to domain entities | User.personId for applicants, User.caseWorkerId for staff |

---

## Options Considered

### Option 1: IdP-Only (No User Service)

Store all roles and permissions in the IdP using custom claims or groups.

| Pros | Cons |
|------|------|
| Simpler architecture (one system) | Limited flexibility for domain-specific roles |
| No additional service to maintain | Organizational scope assignments don't fit IdP data model |
| | Requires IdP customization for each change |
| | Hard to link users to domain entities |

**Not recommended because:** IdP custom attributes are too limited for flexible organizational scoping and domain entity linking.

---

### Option 2: User Service with Runtime Calls

User Service provides permissions; domain APIs call it on each request.

| Pros | Cons |
|------|------|
| Always up-to-date permissions | Added latency on every request |
| Simple JWT (just identity) | User Service is single point of failure |
| | N requests = N permission lookups |
| | Requires caching to be performant |

**Not recommended because:** Runtime dependency on every request creates performance and availability concerns.

---

### Option 3: Policy Engine (OPA/Cedar)

Use a policy decision point (OPA, AWS Cedar) for authorization.

| Pros | Cons |
|------|------|
| Powerful policy language | Additional infrastructure to operate |
| Policies separate from code | Learning curve for policy language |
| Can handle complex rules | Overkill for role-based access |

**Not recommended because:** Adds operational complexity; our access patterns are straightforward role-based with organizational scoping.

---

### Option 4: Embedded Permissions + User Service for Management (RECOMMENDED)

IdP authenticates users. User Service stores roles and provides claims at login. Permissions are embedded in JWT. Domain APIs validate JWT and read claims directly.

| Pros | Cons |
|------|------|
| No runtime User Service calls | Permission changes require token refresh |
| Standard JWT validation | Token may contain many claims |
| User Service manages domain-specific data | Two systems to maintain (IdP + User Service) |
| Clear separation of concerns | |
| Scalable (stateless API requests) | |

**Recommended because:** Best balance of performance, flexibility, and operational simplicity.

---

## Rationale

| Factor | Benefit |
|--------|---------|
| **Separation of concerns** | IdP handles authentication; User Service handles authorization context |
| **No runtime dependency** | Domain APIs don't call User Service per request; permissions in JWT |
| **Multi-tenant support** | User Service manages organizational scope assignments naturally |
| **Flexible scoping** | Supports counties, districts, regions, programs, or custom structures |
| **Domain entity linking** | User.personId and User.caseWorkerId enable scoped access |
| **Audit compliance** | User Service maintains permission change history |
| **Vendor independence** | Works with any IdP that supports JWT and token enrichment |

---

## Consequences

### Positive

- Domain APIs are stateless and performant (no external auth calls)
- Clear separation between identity (IdP) and authorization (User Service)
- Flexible organizational scoping (counties, districts, regions, programs) via JWT claims
- Applicants and staff handled with same pattern (different roles, same flow)
- User Service can be implemented independently of domain services

### Negative

- Permission changes not immediate (requires token refresh)
- JWT may grow large with many permissions
- Two systems to maintain (IdP + User Service)
- IdP must be configured to call User Service during login

### Mitigations

| Concern | Mitigation |
|---------|------------|
| Stale permissions | Short token TTL (15-60 min); force re-login for role changes |
| Large JWT | Use permission categories vs. granular permissions; compress if needed |
| IdP configuration | Document integration patterns for common IdPs (Auth0, Okta) |

---

## User Service Scope

The User Service is intentionally minimal:

**Included:**
- User CRUD (linked to IdP identity)
- Role and organizational scope assignments
- Token claims endpoint (called by IdP at login)
- Current user endpoint (called by frontend on load)
- Audit log of permission changes

**Excluded (belong in other domains):**
- CaseWorker details (skills, team, workload) → Case Management
- Person details → Intake domain
- Work assignments → Workflow domain

---

## Role Hierarchy

Roles have an implicit hierarchy for permission inheritance and escalation paths. The base spec uses county-based terminology, but states can customize via overlays (see [Customizing Roles and Permissions](#customizing-roles-and-permissions)).

```
state_admin
    │
    ├── org_admin (county_admin in base spec)
    │       │
    │       └── supervisor
    │               │
    │               └── case_worker
    │
    └── partner_readonly

applicant (separate hierarchy - self-service only)
```

### Role-to-Permission Mapping

| Role | Permissions | Data Scope |
|------|-------------|------------|
| `applicant` | applications:read, applications:create, applications:update, persons:read, households:read, incomes:read, incomes:create | Own records (by personId) |
| `case_worker` | applications:*, persons:*, households:*, incomes:* | Assigned organizational unit(s) |
| `supervisor` | All of case_worker + applications:approve, persons:read:pii, users:read | Assigned organizational units (may have multiple) |
| `county_admin` | All of supervisor + users:create, users:update, applications:delete | Assigned organizational unit |
| `state_admin` | All permissions | All organizational units |
| `partner_readonly` | applications:read, persons:read | Per agreement |

**Note:** "Organizational unit" varies by state - could be county, district, region, program, or a combination. States define their scoping structure via overlays.

---

## Organizational Scoping

Different states organize case workers and data access differently. The base spec provides `counties` as the default scoping mechanism, but this is customizable via overlays.

### Scoping Patterns by State

| Pattern | Example | JWT Claims |
|---------|---------|------------|
| County-based | California, Texas | `counties: ["06001", "06013"]` |
| District-based | Some states use judicial/admin districts | `districts: ["D1", "D2"]` |
| Region-based | Multi-county regions | `regions: ["central", "northern"]` |
| Program-based | Staff assigned to specific programs | `programs: ["snap", "tanf"]` |
| Hybrid | County + Program | `counties: [...], programs: [...]` |

### One-to-Many Relationships

Staff may be assigned to multiple organizational units:
- A supervisor covering 3 counties
- A specialist working across 2 programs
- A regional coordinator spanning multiple districts

The JWT claims support arrays for this:

```yaml
# Example: Supervisor assigned to multiple counties and programs
scope:
  counties: ["06001", "06013", "06075"]
  programs: ["snap", "tanf"]
```

### Customizing Scope via Overlays

States define their scoping structure by extending `AuthorizationContext`:

```yaml
# Example: State using districts instead of counties
actions:
  - target: $.AuthorizationContext.properties
    file: components/common.yaml
    update:
      districts:
        type: array
        items:
          type: string
        description: Administrative districts the user can access.
        example: ["D1", "D2"]

      # Optionally remove county fields if not used
  - target: $.AuthorizationContext.properties.counties
    file: components/common.yaml
    remove: true
```

See [Customizing Roles and Permissions](#customizing-roles-and-permissions) for more overlay examples.

---

## Implementation

### Files Added

| File | Purpose |
|------|---------|
| `docs/architecture-decisions/adr-auth-patterns.md` | This ADR |
| `packages/schemas/openapi/users.yaml` | User Service API specification |
| `packages/schemas/openapi/components/user.yaml` | User schema components |

### Shared Components Added

| File | Components | Purpose |
|------|------------|---------|
| `components/common.yaml` | `AuthorizationContext`, `JwtClaims`, `RoleType` | JWT structure and role definitions |
| `components/common-responses.yaml` | `Unauthorized`, `Forbidden` | Auth error responses (401, 403) |

### Integration Points

**Token Enrichment Flow:**

When a user logs in, the IdP needs to embed authorization claims in the JWT. This happens during OAuth token issuance:

1. User authenticates with IdP (Auth0, Okta, etc.)
2. IdP calls User Service to get authorization context
3. User Service returns role, permissions, and organizational scope
4. IdP embeds these claims in the JWT it issues
5. Domain APIs read permissions directly from JWT (no runtime calls)

**IdP → User Service:**
```
GET /token/claims/{sub}
X-API-Key: <idp-api-key>

Response: { "userId": "...", "role": "case_worker", "permissions": [...], "scope": {...} }
```

The API key shown above is an example. Teams should use whatever authentication method makes sense for their IdP integration (API key, OAuth2 client credentials, mTLS, etc.).

**Frontend → User Service:**
```
GET /users/me
Authorization: Bearer <jwt>
Response: Full user profile including preferences
```

**Domain APIs → JWT:**
```python
# No User Service call - read from JWT
claims = validate_jwt(request.headers["Authorization"])
if "applications:read" not in claims["permissions"]:
    raise Forbidden()
```

---

## Security Schemes

The default security scheme is JWT bearer authentication:

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

security:
  - bearerAuth: []
```

Different security schemes are supported either per state (via overlays) or per API, depending on requirements. For example, the User Service uses `apiKeyAuth` for the `/token/claims/{sub}` endpoint since it's a machine-to-machine call from the IdP before a JWT exists.

---

## Frontend Authorization Pattern

Frontends need to know what features to show or hide based on the user's permissions. The question is: how should the frontend get this information?

### Options Considered

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| 1. Backend provides `ui` object with modules + action flags | Backend computes which modules and actions are available; frontend reads flags | Simple frontend, single source of truth | More fields to maintain on backend |
| 2. Backend provides `ui` object with modules only | Backend returns available modules; frontend checks `permissions` array for specific actions | Simpler schema | Permission logic duplicated in frontend |
| 3. No `ui` object; frontend parses `permissions` array | Frontend interprets permission strings (e.g., `applications:read`) for everything | Minimal backend work | Complex frontend logic, inconsistent across apps |

### Recommendation

**Option 1: Backend provides `ui` object with modules + action flags**

The User model includes a `ui` object that the backend computes based on the user's role and permissions. This keeps authorization logic on the backend while giving frontends a simple API.

```yaml
ui:
  availableModules: [cases, tasks, reports]
  canApproveApplications: true
  canViewSensitivePII: false
```

The `permissions` array (e.g., `["applications:read", "applications:update"]`) is for API enforcement. The `ui` object is for frontend feature toggling. This separation ensures:

- Frontends don't need to understand permission string patterns
- Changes to permission structure don't break frontend logic
- UI-specific concepts (modules, feature flags) are explicit, not inferred

### Open Question: Structure of the `ui` Object

Given that we recommend the backend provide a `ui` object, what should its internal structure be? The current schema uses flat boolean flags, which is simple but may not scale well. We need to decide on a structure before the schema stabilizes.

**Structures under consideration:**

```yaml
# Option 1: Flat booleans (current)
ui:
  availableModules: [cases, tasks, reports]
  canApproveApplications: true
  canViewSensitivePII: false
  canExportData: true

# Option 2: Nested by module
ui:
  modules:
    cases:
      enabled: true
      actions: [approve, export]
    admin:
      enabled: true
      actions: [manage_users]

# Option 3: Capabilities array
ui:
  modules: [cases, tasks, reports]
  capabilities: [approve_applications, view_pii, export_data]

# Option 4: Flat booleans + custom field
ui:
  availableModules: [cases, tasks]
  canApproveApplications: true
  custom:
    betaFeatures: true
```

**Trade-offs:**

| Option | Simplicity | Extensibility | Type Safety |
|--------|------------|---------------|-------------|
| 1. Flat booleans | High | Low | High |
| 2. Nested by module | Medium | High | High |
| 3. Capabilities array | Medium | High | Lower |
| 4. Flat + custom field | High | Medium | Mixed |

**Decision needed:** Which option best balances simplicity for initial adopters against extensibility for future growth?

---

## Alternative Authentication Mechanisms

The default approach uses JWT bearer tokens with embedded claims. States using different authentication mechanisms can adapt the patterns via the overlay system.

### What Changes by Auth Type

| Auth Mechanism | Token Enrichment Endpoint | Domain API Auth Pattern | Security Scheme |
|----------------|---------------------------|-------------------------|-----------------|
| **JWT (default)** | Used - IdP calls at login | Read claims from JWT | `bearerAuth` |
| **Session cookies** | Not needed | Permissions in session store, or runtime User Service calls | `cookieAuth` |
| **API keys** | Not needed | Runtime User Service calls per request | `apiKeyAuth` |
| **SAML** | Adapted for assertion | Session established after SAML assertion | `cookieAuth` or custom |

### Key Differences Without JWT

1. **Permission retrieval** - Without JWT claims, domain APIs need runtime calls to User Service (Option 2 trade-off: added latency, but always current permissions)
2. **`/token/claims/{sub}` endpoint** - Only needed for JWT enrichment flows; states not using JWT can remove it via overlay
3. **Security scheme** - Must be replaced in all API specs
4. **Frontend auth handling** - With session cookies, the browser manages authentication automatically (no token storage or refresh logic needed); `GET /users/me` still provides the user profile and `ui` permissions object

### Overlay Support

The overlay system can customize authentication for a state:

```yaml
# Example: State using session-based auth instead of JWT
actions:
  # Replace security scheme
  - target: $.components.securitySchemes
    file: users.yaml
    update:
      cookieAuth:
        type: apiKey
        in: cookie
        name: SESSION_ID
        description: Session cookie from state IdP

  # Update global security requirement
  - target: $.security
    file: users.yaml
    update:
      - cookieAuth: []

  # Remove JWT-specific endpoint (if not needed)
  - target: $.paths./token/claims/{sub}
    file: users.yaml
    remove: true

  # Add session validation endpoint (if needed)
  - target: $.paths./session/validate
    file: users.yaml
    update:
      get:
        summary: Validate session and return permissions
        # ...
```

### Customizing Roles and Permissions

States can use overlays to add roles, modify permissions, or extend the authorization context for state-specific needs.

**Adding state-specific roles:**

```yaml
# Example: Texas adds a regional coordinator role
overlay: 1.0.0
info:
  title: Texas State Overlay
  version: 1.0.0

actions:
  # Extend RoleType enum with state-specific roles
  - target: $.RoleType.enum
    file: components/common.yaml
    description: Texas adds regional coordinator role
    update:
      - applicant
      - case_worker
      - supervisor
      - county_admin
      - state_admin
      - partner_readonly
      - regional_coordinator  # Texas-specific: oversees multiple counties in a region

  # Document the new role's scoping behavior
  - target: $.RoleType.description
    file: components/common.yaml
    update: |
      Authorization roles that determine base permissions and data scoping.

      - applicant: Self-service access to own applications (scoped by personId)
      - case_worker: Process applications for assigned county
      - supervisor: Oversee case workers, approve determinations (may span counties)
      - county_admin: Administer county staff and configuration
      - state_admin: Statewide oversight and administration (all counties)
      - partner_readonly: External partner with limited read access
      - regional_coordinator: Texas-specific role for multi-county regional oversight
```

**Adding state-specific permissions:**

```yaml
# Example: New York adds audit-specific permissions for compliance
actions:
  # Extend AuthorizationContext to include audit permissions
  - target: $.AuthorizationContext.properties.permissions.example
    file: components/common.yaml
    description: New York includes audit permissions in examples
    update:
      - "applications:read"
      - "applications:create"
      - "persons:read"
      - "audit:read"           # NY-specific
      - "audit:export"         # NY-specific
      - "compliance:review"    # NY-specific

  # Add state-specific permission documentation
  - target: $.AuthorizationContext.properties.permissions.description
    file: components/common.yaml
    update: |
      Permission strings in the format {resource}:{action}.
      Base permissions: applications:read, persons:update, users:create
      New York additions: audit:read, audit:export, compliance:review
```

**Adding program-based authorization:**

States can add program-based scoping in addition to (or instead of) geographic scoping. California's overlay demonstrates this pattern:

```yaml
# From California's overlay - adding program-based scoping
actions:
  # Add programs to AuthorizationContext (for JWT)
  - target: $.AuthorizationContext.properties
    file: components/common.yaml
    description: California JWT claims may include programs
    update:
      programs:
        type: array
        items:
          type: string
        description: Programs the user is authorized to access (empty = all programs).
        example: ["calfresh", "calworks"]

  # Add programs to User model
  - target: $.User.properties
    file: components/user.yaml
    description: California supports optional program-based assignments
    update:
      programs:
        type: array
        items:
          $ref: "./common.yaml#/Program"
        description: |
          Programs the user is authorized to work on.
          Optional; if empty, user can access all programs within their assigned scope.
        example: ["calfresh", "calworks"]
```

**Restricting permissions for a role:**

States can also restrict what permissions a role receives by default:

```yaml
# Example: State restricts partner access more than the base spec
actions:
  # Override partner_readonly description to clarify restrictions
  - target: $.RoleType.description
    file: components/common.yaml
    update: |
      ...
      - partner_readonly: External partner with read-only access to aggregate
        reports only. No access to individual case data per state policy.
```

**Adding UI modules for state systems:**

```yaml
# Example: California adds CalSAWS integration module
actions:
  - target: $.UiPermissions.properties.availableModules.items.enum
    file: components/user.yaml
    description: California includes CalSAWS integration module
    update:
      - cases
      - tasks
      - reports
      - documents
      - scheduling
      - admin
      - calsaws_integration  # CA-specific legacy system integration
```

### What Stays the Same

Regardless of auth mechanism:

- **User Service** still stores role/permission mappings
- **Separation of concerns** - IdP handles authentication, User Service handles authorization context
- **Permission model** - `{resource}:{action}` format, role-based with organizational scoping
- **Frontend pattern** - `GET /users/me` returns user profile with `ui` permissions object

---

## BFF/Gateway Pattern

When a BFF (Backend-for-Frontend) or API gateway sits between the frontend and backend services, it may handle tokens differently depending on the destination.

### Role of the Middleware

The BFF or gateway acts as an intermediary that can enrich tokens for the frontend while keeping backend API calls minimal:

1. Receives JWT with AuthorizationContext from IdP (during login flow)
2. Calls `/users/me` to get `ui` and `preferences`
3. Creates an enriched token for the frontend
4. Routes the appropriate token based on destination

### Token Routing by Destination

| Destination | Token Contents | Rationale |
|-------------|----------------|-----------|
| **Frontend** | AuthorizationContext + `ui` + `preferences` | Everything the frontend needs for feature toggling and personalization |
| **Backend APIs** | AuthorizationContext only | Minimal claims; only what APIs need for authorization |

### Why the Schema Separation Supports This

The separation between AuthorizationContext (minimal, for API enforcement) and the User model (`ui` + `preferences`) supports both direct and BFF patterns:

- **AuthorizationContext stays minimal** - Backend APIs receive only what they need for authorization decisions
- **`ui` and `preferences` live on User** - Retrieved via `/users/me`, not embedded in every JWT
- **Middleware combines as needed** - BFF can enrich tokens for frontend without bloating backend API calls
- **Backend APIs never receive `ui` data** - They don't need it; authorization is based on `permissions` and organizational scope

### Frontend Behavior with Middleware

When a BFF/gateway is present, the frontend experience may differ:

| Aspect | Direct (No Middleware) | With BFF/Gateway |
|--------|------------------------|------------------|
| `/users/me` call | Frontend calls directly | Middleware may provide data in enriched token |
| Token contents | AuthorizationContext only | May include `ui` + `preferences` |
| Feature toggling | Based on `/users/me` response | Based on enriched token |
| Backend API calls | Frontend sends JWT directly | Middleware routes appropriate token |

In both cases, backend APIs still receive minimal tokens with just AuthorizationContext for authorization.

---

## Security Considerations

### Token Security

- JWTs should have short expiration (15-60 minutes)
- Use refresh tokens for longer sessions
- Validate JWT signature on every request
- Check `aud` claim matches your API

### PII Protection

- `persons:read:pii` permission required for unmasked SSN
- Audit log access to sensitive fields
- Consider field-level encryption for SSN at rest

### Audit Trail

The User Service maintains an audit log of:
- User creation and deactivation
- Role changes
- Organizational scope assignment changes
- Permission modifications

---

## References

- [User Service API Specification](../../packages/schemas/openapi/users.yaml)
- [Auth0 Actions](https://auth0.com/docs/customize/actions) - Example IdP integration
- [Okta Hooks](https://developer.okta.com/docs/concepts/event-hooks/) - Example IdP integration
- [JWT RFC 7519](https://datatracker.ietf.org/doc/html/rfc7519)
