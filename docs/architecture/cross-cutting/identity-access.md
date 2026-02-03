# Identity & Access

Quick reference for authentication and authorization patterns.

> For full rationale and alternatives considered, see [ADR: Auth Patterns](../../architecture-decisions/adr-auth-patterns.md).

## Architecture

Three-layer approach: IdP for authentication, User Service for authorization context, JWT for stateless API calls.

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
       │                 └─────────────────────────────────────────┘
       │
       │ Authorization: Bearer <jwt>
       ▼
┌─────────────────────────────────────────────────────────────────┐
│                          Domain APIs                            │
│  - Validate JWT signature                                       │
│  - Read permissions from claims                                 │
│  - Filter data by organizational scope                          │
│  - No runtime calls to User Service                            │
└─────────────────────────────────────────────────────────────────┘
```

## Roles

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

| Role | Typical Permissions | Data Scope |
|------|---------------------|------------|
| `applicant` | applications:read/create/update, persons:read | Own records (by personId) |
| `case_worker` | applications:*, persons:*, households:*, incomes:* | Assigned organizational unit(s) |
| `supervisor` | case_worker + applications:approve, persons:read:pii | Multiple organizational units |
| `org_admin` | supervisor + users:create/update, applications:delete | Assigned organizational unit |
| `state_admin` | All permissions | All organizational units |
| `partner_readonly` | applications:read, persons:read | Per agreement |

## Organizational Scoping

Staff may be scoped by geography, program, or both. The base spec uses counties; states customize via overlays.

| Pattern | Example States | JWT Claims |
|---------|----------------|------------|
| County-based | California, Texas | `counties: ["06001", "06013"]` |
| District-based | — | `districts: ["D1", "D2"]` |
| Region-based | — | `regions: ["central", "northern"]` |
| Program-based | — | `programs: ["snap", "tanf"]` |
| Hybrid | — | `counties: [...], programs: [...]` |

## Integration Points

| Flow | Endpoint | Purpose |
|------|----------|---------|
| IdP → User Service | `GET /token/claims/{sub}` | Get claims to embed in JWT at login |
| Frontend → User Service | `GET /users/me` | Get user profile with `ui` permissions |
| Domain APIs | — | Validate JWT, read claims directly |

## Auth Context Schemas

| Schema | Location | Purpose |
|--------|----------|---------|
| `BackendAuthContext` | common.yaml | Minimal claims for API authorization |
| `FrontendAuthContext` | user.yaml | Extends BackendAuthContext with `ui` and `preferences` |

## Resources

- [User Service API](../../../packages/schemas/openapi/users.yaml) — Full OpenAPI specification
- [ADR: Auth Patterns](../../architecture-decisions/adr-auth-patterns.md) — Decision rationale, options considered, security details
