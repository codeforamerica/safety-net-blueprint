# Client Management Domain

> **Status:** Placeholder — no contracts implemented yet.

See [Domain Design Overview](../domain-design.md) for context and [Contract-Driven Architecture](../contract-driven-architecture.md) for the contract approach.

## Overview

The Client Management domain is the system of record for **persons** — unique, de-duplicated individuals across all interactions with the safety net system. It resolves identity across applications and cases, and makes person records available to other domains.

**Entities owned by this domain:**

- **Person** — a unique, de-duplicated individual record

## Entities

### Person

A unique individual, de-duplicated across applications and cases. Multiple applications may reference the same person; Client Management resolves that identity.

> Full schema TBD.

## Person Matching

When an application is submitted, Client Management attempts to match each applying member to an existing person record.

### Inbound: `intake.application.submitted`

Client Management subscribes to this event. The event carries `applicationId` and `memberIds` (all household members). Client Management fetches each member record from the Intake API and matches only members who are applying for at least one program (i.e., `programsApplyingFor` is non-empty). Members with no programs — household members counted for size only — are skipped.

Client Management does not receive PII from the event. It calls `GET /intake/applications/{applicationId}/members/{memberId}` with appropriate authorization to retrieve the data it needs for matching (name, DOB, SSN, address). PII is kept off the event bus because the event bus is lower-trust infrastructure: broader fan-out, longer retention, more consumers. Direct authenticated API calls carry PII only to the consumer that needs it.

### Outbound: `client_management.person.match_resolved`

Client Management emits one event per applying member after attempting to match:

| Field | Type | Notes |
|-------|------|-------|
| `memberId` | uuid | The ApplicationMember this result is for |
| `matchType` | enum | `confirmed`, `review_required`, `no_match` |
| `candidates` | array | Match candidates with confidence scores (see below) |

**`matchType` values:**

- `confirmed` — high-confidence match; `candidates` contains the single matched person
- `review_required` — one or more probable matches require caseworker review; `candidates` lists them with confidence scores; Client Management emits a follow-up event after review resolves
- `no_match` — no existing person found; `candidates` is empty; person creation is deferred (see Decision 2)

**Candidate shape:** `{ personId: uuid, confidence: 0–1 }` — no PII. Intake calls the Client Management API if it needs display details (name, DOB) for the caseworker review UI.

Intake's Application state machine handles both the initial and follow-up events. `applicationId` is not in the event payload — `memberId` alone is sufficient to correlate back to an application.

---

## Key Design Decisions

### Decision 1: PII stays off the event bus

**Status:** Decided

**What's being decided:** Whether `intake.application.submitted` should carry member PII (name, DOB, SSN, address) needed for person matching.

**Decision:** The event carries `memberIds` only. Client Management calls back to the Intake API with appropriate authorization to retrieve PII for matching. The event bus is lower-trust infrastructure — broader fan-out, longer retention, more consumers — and PII should only travel over direct authenticated connections to the consumer that needs it. This is consistent with how FHIR-based systems handle patient matching: the match request references a resource endpoint rather than embedding identifiers in the message.

---

### Decision 2: No person record created on no-match at application time

**Status:** Decided

**What's being decided:** Whether Client Management should auto-create a person record when no match is found at submission time.

**Decision:** No. Applying for benefits does not establish a permanent relationship with the system — the application may be withdrawn, denied, or abandoned. A person record is a long-lived, authoritative record; creating one before any outcome is determined risks polluting the system with records for people who never receive services. Person creation is deferred to a later lifecycle event where the relationship is established (e.g., case creation). When no match is found, Client Management returns `no_match` and `personId` remains null on the `ApplicationMember` record.

---

### Decision 3: Match only applying members

**Status:** Decided

**What's being decided:** Whether all household members should be matched against person records, or only those applying for benefits.

**Decision:** Only members with a non-empty `programsApplyingFor` are matched. Household members counted for size only (e.g., non-citizen members counted for SNAP household size but not applying for Medicaid) have no reason to appear in the person registry at application time. This determination is made by Client Management based on the member record it fetches — the `application.submitted` event carries all `memberIds` and Client Management filters.

---

### Decision 4: One `person.match_resolved` event per member

**Status:** Decided

**What's being decided:** Whether to emit one event per application (all members resolved together) or one event per member as each resolves.

**Decision:** One event per member. Matching each member may take different amounts of time (especially when manual review is required for one member but not others). Emitting per-member allows Intake to record results incrementally rather than blocking the entire application on the slowest member. When `review_required` is returned, a follow-up `person.match_resolved` is emitted after manual resolution.

---

## Key Design Questions

- **Post-case person merge** — if a duplicate is discovered after a case has been created, how is the merge propagated to Intake, Case Management, and Eligibility?
- **Person creation trigger** — what specific lifecycle event triggers person record creation for a `no_match` member? Case creation? Approval? TBD as the Case Management domain is designed.
- **Domain boundary for the ApplicationMember → Person mapping** — Intake owns `ApplicationMember`; Client Management owns `Person`. The resolved `personId` is written back to `ApplicationMember.personId` by Intake when it handles `person.match_resolved`.

---

## Contract Artifacts

| Artifact | Status | Notes |
|----------|--------|-------|
| OpenAPI spec | Alpha | `persons-openapi.yaml` — Person CRUD. Declares `person.match_resolved` in `x-events`. |
| Event schemas | Defined | `schemas/client-management-events.yaml` — `PersonMatchResolvedEvent` and `PersonMatchCandidate` |
| Event subscriptions | TBD | `intake.application.submitted` |
| Event publications | Defined | `client_management.person.match_resolved` |
