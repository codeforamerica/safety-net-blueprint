# Identity & Access

This document is the architecture reference for authentication and authorization in the Safety Net
Blueprint. It covers the three-layer auth model, role and organizational scoping, OAuth scope design,
service-to-service authentication, event actor provenance, and API security declarations. Vendor
systems compared: JSM/Atlassian, ServiceNow, IBM Cúram, and Salesforce Government Cloud. Regulatory
standards referenced: IRS Publication 1075 (Federal Tax Information), NIST SP 800-53, FedRAMP.

> Supersedes [ADR: Auth Patterns](../../decisions/auth-patterns.md).

## Overview

Identity and access is a cross-cutting concern that provides the authentication and authorization
foundation for all Safety Net Blueprint domains. It owns the user identity model, JWT claim
structure, role definitions, organizational scope model, OAuth scope definitions,
service-to-service auth patterns, event actor identification, and API security declarations.
It does not own authorization business rules within individual domains — those are enforced by
each domain using the claims this layer defines.

The primary objects are the **User** (a caseworker, supervisor, applicant, or service account)
and the **JWT** (a short-lived token carrying authorization claims, issued by the Identity
Provider and validated by domain APIs without runtime calls to any authorization service).

Some deployments place a BFF (Backend-for-Frontend) or API gateway between the frontend and
domain APIs to handle token enrichment, routing, and session management. The auth patterns
here support both direct and BFF-mediated topologies.

```
┌──────────────┐         ┌─────────────────────────────────────────┐
│   Frontend   │────────▶│         Identity Provider (IdP)         │
│              │  login  │  Auth0, Okta, Keycloak, Cognito, etc.  │
│  - Stores JWT│◀────────│  - Authenticates users (login, MFA)    │
│  - Calls APIs│   JWT   │  - Calls User Service to enrich tokens │
└──────┬───────┘         └──────────────────┬──────────────────────┘
       │                                    │
       │ GET /users/me                      │ GET /token/claims/{sub}
       │ (ui + preferences)                 │ (at login time)
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

This diagram reflects a **three-layer auth model**:

- **Layer 1 — Identity Provider:** Authenticates credentials (password, MFA, certificates) and issues JWTs.
- **Layer 2 — User Service:** Resolves authorization context (role, permissions, organizational scope) at login. Called once by the IdP; the result is embedded in the JWT.
- **Layer 3 — Domain APIs:** Validate JWT signature and read claims at request time. No runtime calls to Layer 1 or 2.

Each layer has a distinct responsibility. States can substitute components within a layer (e.g., swap the IdP vendor, replace JWT with session auth) without changing the other layers.

## What happens during authentication

1. A user or service account presents credentials to the Identity Provider (IdP).
2. The IdP authenticates the identity (password, MFA, certificate, or client credentials).
3. For user logins, the IdP calls the User Service to retrieve the user's role, permissions,
   and organizational scope.
4. The IdP embeds these claims in a JWT and returns it to the caller.
5. For service-to-service calls, a service account authenticates using client credentials —
   no user is present, and no profile service call occurs. The service account's identity is
   embedded in the JWT directly.
6. All subsequent API calls carry the JWT. Domain APIs validate the signature and read claims
   without runtime calls to the User Service.

## What happens during authorization

1. A domain API receives a request with a bearer token.
2. The API validates the JWT signature and checks that it has not expired.
3. The API reads the permissions array from the token claims and enforces the required
   permission for the requested operation.
4. For staff, the API filters returned data to the organizational units listed in the token's
   scope claims (counties, districts, programs, or state-defined equivalent).
5. For applicants, the API filters returned data to the individual's own records (scoped by
   userId).
6. For operations involving Federal Tax Information, the actor identity from the token is
   captured in the audit log. (IRS Pub. 1075)

## Regulatory requirements

### IRS Publication 1075 — Federal Tax Information (FTI)

States receiving FTI through federal data matching (e.g., IRS income verification for SNAP
eligibility) must meet IRS Pub. 1075 safeguard requirements:

| Requirement | Description |
|---|---|
| Unique user identification | Every action on FTI must be associated with a unique, individually assigned identifier — not a shared account |
| Actor capture | Audit records must identify who performed each action |
| Audit log retention | 7 years minimum for all records involving FTI access |
| Weekly log review | Audit logs must be reviewed weekly |

The User Service provides unique user identification. States must implement audit log archival
independently — see [Capability coverage](#capability-coverage).

### NIST SP 800-53 / FedRAMP

| Control | Requirement |
|---|---|
| AC-2 | Unique user identification in all audit logs |
| AU-2 / AU-3 | Audit records must include: user identity, event type, time, outcome |
| OAuth 2.0 | Required for API authentication under FedRAMP baseline |

## Entity model

### User

The central identity record. Stored in the User Service. Contains identity and authorization
data only — no links to domain entities. Domain entities that need to associate with a user hold
a `userId` reference pointing back to User Service. This matches the pattern used by IBM Cúram
(`ConcernRole.userAccount`), ServiceNow (`Task.assigned_to`), and Salesforce (`Contact.OwnerId`).

Key fields:
- `userId` — stable UUID; the canonical identifier used in JWT claims and event `authid` fields.
  Same value as the `id` field on the User resource.
- `roles` — Role object containing `name` (RoleType) and `permissions` (array of
  `{resource}:{action}` strings, e.g., `applications:read`)

All major platforms have an equivalent user identity concept with a stable, non-email identifier.

### JWT Claims (BackendAuthContext)

The minimal authorization context embedded in a JWT for API enforcement. Derived at login from
User Service data; not a persisted entity.

Key fields:
- `userId` — matches `User.id`; the value carried in the `authid` event extension attribute
- `roles` — Role object containing `name` (RoleType) and `permissions` (array of
  `{resource}:{action}` strings, e.g., `applications:read`)

Organizational scope claims (`counties`, `districts`, `programs`, etc.) are not part of the
base BackendAuthContext. States add them via overlay — see [Customization](#customization).

See [Decision 1](#decision-1-oauth-scope-granularity) for how OAuth scopes relate to this model.

### FrontendAuthContext

Extends BackendAuthContext with `ui` (available modules and action flags) and `preferences`
(display settings). Returned by `GET /users/me`. Backend domain APIs never receive this context.

The `ui` object uses `additionalProperties: true` with flat example fields. There is no
prescribed structure — states define their own fields via overlay. The baseline provides example
fields (`availableModules`, boolean action flags) as a starting point.

### Role hierarchy

```
state_admin
    │
    ├── county_admin
    │       │
    │       └── supervisor
    │               │
    │               └── case_worker
    │
    └── partner_readonly

applicant (separate hierarchy — self-service only)
```

The hierarchy is conceptual; the User Service computes the `permissions` array for each role.
States extend the `RoleType` enum via overlay to add state-specific roles.

| Role | Permissions | Data scope |
|---|---|---|
| `applicant` | applications:read/create/update, persons:read, households:read | Own records (by personId) |
| `case_worker` | applications:*, persons:*, households:*, incomes:* | Assigned organizational unit(s) |
| `supervisor` | case_worker + applications:approve, persons:read:pii | Multiple organizational units |
| `county_admin` | supervisor + users:create/update, applications:delete | Assigned organizational unit |
| `state_admin` | All permissions | All organizational units |
| `partner_readonly` | applications:read, persons:read | Per agreement |

### Organizational scoping

Staff may be scoped by geography, program, or both. The base spec uses counties; states
customize via overlays.

| Pattern | Example states | JWT claim |
|---|---|---|
| County-based | California, Texas | `counties: ["06001", "06013"]` |
| District-based | — | `districts: ["D1", "D2"]` |
| Region-based | — | `regions: ["central", "northern"]` |
| Program-based | — | `programs: ["snap", "tanf"]` |
| Hybrid | — | `counties: [...], programs: [...]` |

## Authorization lifecycle

### Token states

| State | Description |
|---|---|
| `active` | Valid JWT within TTL; accepted by domain APIs |
| `expired` | TTL elapsed (15–60 minutes); client must refresh or re-authenticate |
| `revoked` | Force-invalidated due to role change or deactivation; next validation fails |

### Key transitions

- **Login → active** — IdP authenticates, User Service provides claims, JWT issued with
  configured TTL.
- **TTL elapsed → expired** — Client presents refresh token or re-authenticates.
- **Role change → revoked** — User Service flags the change; subsequent API calls fail,
  requiring re-authentication. Short TTL bounds the exposure window.

## OAuth scope model

OAuth scopes define the outer authorization boundary at the IdP — what a client application is
permitted to request. Fine-grained enforcement (which specific operations a user can perform)
happens at the domain API level via the JWT `permissions` claims. See
[Decision 1](#decision-1-oauth-scope-granularity).

Baseline scopes:

| Scope | Used by |
|---|---|
| `{domain}:read` | User-facing clients reading from a domain (e.g., `intake:read`) |
| `{domain}:write` | User-facing clients writing to a domain (e.g., `workflow:write`) |
| `service` | Service accounts and batch processes (client credentials flow) |

## Service-to-service authentication

Background jobs, scheduled processes, and inter-domain service calls authenticate using the
OAuth 2.0 Client Credentials grant. No user is present. The service account is identified by a
`userId` in the JWT — the same field used for human users — ensuring service account actions
appear in audit logs and event `authid` fields without special handling. See
[Decision 2](#decision-2-service-to-service-authentication).

```
POST /oauth/token
grant_type=client_credentials
client_id=<service-client-id>
client_secret=<service-client-secret>
scope=service intake:read
```

The issued JWT carries the service account's `userId`. Domain APIs treat it identically to a
user JWT.

## Event actor provenance

Domain events carry the CloudEvents Auth Context extension attributes identifying who triggered
the action. This satisfies IRS Pub. 1075's unique-user-identification requirement for events
involving FTI. See [Decision 3](#decision-3-event-actor-provenance).

Two extension attributes are added to the CloudEvents envelope:

- `authtype` — principal type (`user`, `service_account`, `api_key`, `system`,
  `unauthenticated`, `unknown`). Required when `authid` is present.
- `authid` — the `userId` from the JWT claims at the time the event is emitted. No PII —
  use `userId`, not email.

```yaml
# CloudEvents extension attributes (envelope level, not inside data)
authtype: service_account
authid: usr_8f3a2b1c-4d5e-6f7a-8b9c-0d1e2f3a4b5c
```

Both attributes are **required** for all domain events on FTI-governed endpoints. They are
recommended for all domain events to simplify audit compliance and enable broker-level filtering
by principal type.

## API security declarations

Every domain API spec declares `security: - bearerAuth: []` at the spec level, referencing the
shared security scheme in `components/auth.yaml`. Operations that use a different auth method
(e.g., the `/token/claims/{sub}` endpoint using an API key) declare their scheme at the
operation level, overriding the spec-level default. See
[Decision 4](#decision-4-api-security-declarations).

## Customization

States can override the following via overlay:

- **Security scheme** — Replace `bearerAuth` with `cookieAuth`, SAML, or a custom scheme.
  States not using JWT must also remove `/token/claims/{sub}` from the User Service spec;
  domain APIs will need runtime authorization calls without embedded JWT claims.
- **BackendAuthContext scope fields** — Add state-specific organizational scope claims
  (`counties`, `districts`, `regions`, `programs`). The base BackendAuthContext has no scope
  fields — states define what they need via overlay. Example: California adds `counties`; a
  district-based state adds `districts` instead.
- **RoleType enum** — Extend with state-specific roles (e.g., `regional_coordinator`). The
  User Service implementation computes permissions for extended roles.
- **OAuth scopes** — Define additional scopes at the IdP level for state-specific integrations.
- **`ui` object fields** — The `UiPermissions` schema uses `additionalProperties: true`. States
  define their own fields via overlay with no baseline constraint on structure.

## Contract artifacts

| Artifact | File |
|---|---|
| User Service API | `packages/contracts/users-openapi.yaml` |
| Shared security schemes | `packages/contracts/components/auth.yaml` |
| JWT claim schemas | `packages/contracts/components/auth.yaml` |
| Frontend auth context | `packages/contracts/users-openapi.yaml` (`FrontendAuthContext`, `UiPermissions`) |
| CloudEvents envelope pattern | `packages/contracts/patterns/api-patterns.yaml` |

## Key design decisions

| # | Decision | Summary |
|---|---|---|
| 1 | [OAuth scope granularity](#decision-1-oauth-scope-granularity) | Coarse per-domain scopes at IdP; fine-grained enforcement via JWT `permissions` claims |
| 2 | [Service-to-service authentication](#decision-2-service-to-service-authentication) | Client Credentials grant; service account `userId` in JWT |
| 3 | [Event actor provenance](#decision-3-event-actor-provenance) | CloudEvents Auth Context extension (`authid` + `authtype`); required for FTI events |
| 4 | [API security declarations](#decision-4-api-security-declarations) | Shared scheme in components; `security: - bearerAuth: []` per domain spec |

---

### Decision 1: OAuth scope granularity

**Status:** Decided

**What's being decided:** Whether OAuth scopes should be coarse (per-domain), fine-grained
(per-resource or per-operation), or omitted in favor of JWT claims alone.

**Considerations:**
- All four vendors use a two-tier model: OAuth scopes define the outer boundary; service-level
  permissions handle fine-grained enforcement. Atlassian enforces coarse-to-moderate scopes at
  the API gateway; Salesforce issues broad default scopes (`api`, `full`) with fine-grained
  access at the service layer; ServiceNow binds scopes per endpoint.
- Fine-grained OAuth scopes do not eliminate service-level permission checks — they duplicate
  the enforcement that the JWT `permissions` array already provides, adding IdP configuration
  overhead with no reduction in enforcement code.

**Options:**
- **(A)** ✓ Coarse per-domain scopes at the IdP (`intake:read`, `workflow:write`) + fine-grained
  enforcement via JWT `permissions` claims at the domain API
- **(B)** Fine-grained per-operation scopes at the IdP (e.g., `applications:approve`)
- **(C)** No OAuth scopes; rely entirely on JWT `permissions` claims

**Customization:** States can define additional scopes at their IdP for state-specific
integrations. States with stricter gateway enforcement can adopt more granular scopes via
overlay on the security scheme.

---

### Decision 2: Service-to-service authentication

**Status:** Decided

**What's being decided:** How service accounts and batch processes authenticate to domain APIs
when no user is present.

**Considerations:**
- All four vendors use OAuth 2.0 Client Credentials grant for machine-to-machine calls. This
  is the established pattern with no credible alternative in modern API platforms.
- Salesforce's "Run As User" pattern assigns a licensed, named user identity to a Connected
  App, making service account actions fully traceable in audit logs — same traceability as
  human users.
- IRS Pub. 1075 requires unique user identification for all FTI access, including automated
  processes. API keys without embedded user identity are insufficient.

**Options:**
- **(A)** ✓ OAuth 2.0 Client Credentials grant; `service` scope; service account identified
  by `userId` in the JWT
- **(B)** Per-service API keys; no OAuth token; no embedded user identity
- **(C)** Mutual TLS (mTLS) for service identity; no bearer token

**Customization:** States can require additional scopes for specific integrations and can layer
mTLS on top of bearer token auth for defense-in-depth.

---

### Decision 3: Event actor provenance

**Status:** Decided

**What's being decided:** How domain events record the identity of who triggered them, to
satisfy audit and FTI compliance requirements.

**Considerations:**
- The CloudEvents specification defines an official Auth Context extension (`authcontext`) with
  `authtype` (required when using the extension), `authid` (principal identifier, no PII), and
  `authclaims` (optional claims). Using the standard extension avoids defining a custom
  attribute for a problem the specification already solves.
- All major cloud event platforms preserve CloudEvents extension attributes end-to-end: Azure
  Event Grid explicitly documents extension attribute pass-through; Google Cloud Pub/Sub
  preserves extensions via its CloudEvents protocol binding; Apache Kafka's binding spec
  guarantees that mapping functions must not modify CloudEvents. AWS EventBridge supports custom
  extensions via input transformers; end-to-end behavior for auth context attributes is not
  explicitly documented but consistent with its general extension support.
- Industry vendors (Atlassian `accountId`, Salesforce `CreatedById`) use their own fields
  rather than the CloudEvents standard. Their patterns informed the design but predate the
  CloudEvents Auth Context extension.
- IRS Pub. 1075 requires unique user identification; it does not require actor type labeling.
  The `authtype` attribute satisfies this requirement as part of the standard extension and
  enables broker-level filtering by principal type at no additional cost.

**Options:**
- **(A)** Custom `actor` attribute carrying `userId` only
- **(B)** ✓ CloudEvents Auth Context extension: `authid` (userId, no PII) + `authtype`
  (principal type, required when using extension)
- **(C)** No envelope attribute; rely on application-level audit log separate from events

**Customization:** The `authtype` enum is defined by the CloudEvents Auth Context extension
spec. States needing additional principal types can use `authclaims` to carry supplementary
claims without extending the enum.

---

### Decision 4: API security declarations

**Status:** Decided

**What's being decided:** Where `security:` declarations live and how they are applied to
domain API specs.

**Considerations:**
- OpenAPI 3.0 best practice: security schemes defined once in `components/securitySchemes`;
  applied at the spec level (all operations inherit) or overridden per operation.
- Declaring `security: - bearerAuth: []` at the spec level in each domain spec makes
  enforcement explicit in the contract, visible in generated documentation, and enforced by
  generated clients.
- A shared base spec (option C) is non-standard and increases tooling complexity without
  benefit.

**Options:**
- **(A)** ✓ Shared scheme in `components/auth.yaml`; `security: - bearerAuth: []` at the top
  of each domain spec; operation-level overrides for endpoints using different auth
- **(B)** Security scheme declared independently in each domain spec (no shared component)
- **(C)** Global security in a shared base spec that all domain specs reference

---

## Out of scope

| Capability | Domain | Notes |
|---|---|---|
| CaseWorker operational data (skills, team, workload) | Workflow | Owned by the Workflow domain |
| Person identity (name, SSN, contact details) | Intake | Owned by the Intake domain |
| Work assignments and task routing | Workflow | Owned by the Workflow domain |
| Policy decision engines (OPA, Cedar) | State extension | Baseline JWT model covers standard needs; states may adopt a PDP via overlay |

## Capability coverage

Standard capabilities found in major platforms (JSM, ServiceNow, IBM Cúram, Salesforce Government Cloud), and the blueprint's current coverage.

Status values: **Planned** = on the roadmap with a tracking issue; **Partial** = some coverage exists; **Not in scope** = intentional design boundary; **Adapter layer** = intentionally delegated to the state adapter; **Gap** = not yet assessed.

### Token management

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Immediate token revocation | All major platforms support token blocklists or session invalidation | **Adapter layer** — JWT TTL bounds exposure window (15–60 min); states requiring immediate revocation implement a blocklist or switch to session auth via overlay |

### Compliance

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Audit log retention (7-year FTI) | Enterprise platforms delegate log archival to SIEM or cloud storage | **Adapter layer** — states handling FTI configure external archival at their IdP/infrastructure layer |
| MFA policy enforcement | All major platforms delegate MFA policy to the IdP | **Adapter layer** — IdP responsibility; baseline contracts have no opinion on MFA policy |

### Identity federation

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Delegation and impersonation | JSM, ServiceNow, and Pega support acting-as with dual-identity audit trail | **Planned** — see #181 |

### Contract completeness

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Security declarations on all domain API specs | All major platforms declare auth requirements per-spec | **Planned** — follow-on implementation issue; 10 of 11 domain specs missing `security: - bearerAuth: []` |

## References

- [User Service API](../../../packages/contracts/users-openapi.yaml)
- [CloudEvents envelope pattern](../../../packages/contracts/patterns/api-patterns.yaml)
- [Inter-domain communication architecture](inter-domain-communication.md)
- [Superseded: ADR Auth Patterns](../../decisions/auth-patterns.md)
- [CloudEvents Auth Context Extension](https://github.com/cloudevents/spec/blob/main/cloudevents/extensions/authcontext.md)
- [CloudEvents Specification 1.0](https://cloudevents.io/)
- IRS Publication 1075 — Safeguarding Federal Tax Information
- NIST SP 800-53 Rev. 5 — Security and Privacy Controls
- RFC 7519 — JSON Web Token (JWT)
- RFC 6749 — OAuth 2.0 Authorization Framework
