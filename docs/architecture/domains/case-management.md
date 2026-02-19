# Case Management Domain

> **Status:** Case API implemented (alpha). Other entities (CaseWorker, Supervisor, Office, Team, Assignment, Caseload) are future work.

See [Domain Design Overview](../domain-design.md) for context and [Contract-Driven Architecture](../contract-driven-architecture.md) for the contract approach.

## Overview

The Case Management domain manages ongoing client relationships, staff, and organizational structure.

## Current Implementation

### Case

The long-lived relationship with a client or household — it spans years, multiple applications, and multiple programs. [Spec: `case-management-openapi.yaml`](../../../packages/contracts/case-management-openapi.yaml)

| Field | Type | Industry Source |
|-------|------|-----------------|
| `id` | uuid, readOnly | Universal |
| `status` | enum | [CMMN](https://www.omg.org/spec/CMMN/1.1/About-CMMN): active/completed/terminated/suspended/closed/failed; [Salesforce](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_case.htm): New/Working/Escalated/Closed; [NIEM](https://www.niem.gov/) |
| `effectiveStartDate` | date | [FHIR Coverage](https://hl7.org/fhir/coverage.html): `period.start`; benefits domain standard for eligibility/coverage periods |
| `effectiveEndDate` | date (nullable) | FHIR Coverage: `period.end`; null while case is active |
| `primaryApplicantId` | uuid (ref Person) | Salesforce: `ContactId`; [FHIR EpisodeOfCare](https://hl7.org/fhir/episodeofcare.html): `patient` (subject); NIEM: case subject |
| `members` | CaseMember[] | Salesforce: `CaseContactRole` (junction object with role info); [CMMN](https://www.omg.org/spec/CMMN/1.1/About-CMMN): CaseFile |
| `assignedToId` | uuid (ref User) | Salesforce: `OwnerId`; FHIR EpisodeOfCare: `careManager`; CMMN: case roles |
| `createdAt` | date-time, readOnly | Universal; required by `api-patterns.yaml` |
| `updatedAt` | date-time, readOnly | Universal; required by `api-patterns.yaml` |

**Status values:** `active`, `closed`

**Key design decisions:**
- `members` uses structured `CaseMember` objects (`personId` + `relationship`) rather than a flat ID array — follows Salesforce's `CaseContactRole` pattern. Adding per-member fields later (e.g., `role`, `startDate`) is a non-breaking change.
- Effective dates use `date` format (not `date-time`) since eligibility periods are date-granular, matching FHIR Coverage `period`.

## Future Work

### Entities

| Entity | Purpose | Industry Source |
|--------|---------|----------------|
| **CaseWorker** | Staff who processes cases; adds domain-specific attributes (skills, caseload) to User | Salesforce: User (with role); [FHIR Practitioner](https://hl7.org/fhir/practitioner.html); CMMN: Case Role Performer |
| **Supervisor** | CaseWorker with approval authority and team oversight | Salesforce: Role hierarchy; ServiceNow: Manager field |
| **Office** | Geographic or organizational unit (county, regional, state) | ServiceNow: Location; Salesforce: Business Unit; [FHIR Organization/Location](https://hl7.org/fhir/organization.html) |
| **Team** | Group of case workers | Salesforce: `CaseTeam`; ServiceNow: Assignment Group; Camunda: Candidate Group |
| **Assignment** | Who is responsible for what — tracking responsibility | Salesforce: `CaseTeamMember`; CMMN: Case Roles; ServiceNow: Assignment |
| **Caseload** | Workload metrics per worker | Benefits-domain-specific (no direct equivalent in generic standards) |

### Key Relationships

```
Office (1) ──────< (many) CaseWorker
Office (1) ──────< (many) Team
Team (1) ────────< (many) CaseWorker
Supervisor (1) ──< (many) CaseWorker (via supervisorId)
CaseWorker (1) ──< (many) Task (via assignedToId)
CaseWorker (1) ──< (many) Case (via assignedWorkerId)
```

## Contract Artifacts

Case Management is primarily **data-shaped** — most interactions are CRUD on cases, workers, teams, and offices. Some operations are behavioral (case transfer, workload rebalancing).

| Artifact | Status | Notes |
|----------|--------|-------|
| OpenAPI spec | Alpha | `case-management-openapi.yaml` — Case CRUD. Workers, supervisors, offices, teams, assignments, caseloads TBD |
| State machine YAML | TBD | Case lifecycle (active, inactive, closed, transferred) with guards and effects |
| Rules YAML | TBD | Assignment routing rules (skill/program matching, workload balancing) |

## Key Design Questions

- **Case lifecycle** — What states and transitions does a case go through? What triggers active to inactive or closed?
- **Transfer behavior** — When a case transfers (new office or worker), what happens to active tasks? Automatic reassignment, or manual?
- **Workload balancing** — Is rebalancing a behavioral operation (RPC with rules) or administrative?
- **Worker availability** — When a worker goes on leave, how are their tasks redistributed?
- **Domain boundary with Workflow** — Case Management tracks *who* is assigned; Workflow tracks *task state* and applies routing rules. Where exactly does assignment logic live?

## Related Documents

| Document | Description |
|----------|-------------|
| [Domain Design](../domain-design.md) | Case Management section in the domain overview |
| [Workflow](workflow.md) | Task lifecycle and routing — closely related domain |
| [Scheduling](scheduling.md) | Appointments involve assigned staff from Case Management |
| [Contract-Driven Architecture](../contract-driven-architecture.md) | Contract artifacts and the adapter pattern |
