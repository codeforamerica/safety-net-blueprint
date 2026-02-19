# Scheduling Domain

> **Status:** Appointment API implemented (alpha). Schedule and Slot entities are future work.

See [Domain Design Overview](../domain-design.md) for context and [Contract-Driven Architecture](../contract-driven-architecture.md) for the contract approach.

## Overview

Time-based coordination for safety net benefits programs. The scheduling domain manages appointments between staff and people receiving benefits.

## Current Implementation

### Appointment

A scheduled interaction between a staff member and a person at a given time. [Spec: `scheduling-openapi.yaml`](../../../packages/contracts/scheduling-openapi.yaml)

| Field | Type | Industry Source |
|-------|------|-----------------|
| `id` | uuid, readOnly | Universal |
| `startAt` | date-time | [FHIR Appointment](https://hl7.org/fhir/appointment.html): `start`; [RFC 5545](https://datatracker.ietf.org/doc/html/rfc5545) iCalendar VEVENT: `DTSTART` |
| `endAt` | date-time | FHIR Appointment: `end`; RFC 5545: `DTEND` |
| `appointmentType` | string | FHIR Appointment: `appointmentType` (CodeableConcept — extensible, not a fixed enum) |
| `status` | enum | FHIR Appointment: proposed/booked/fulfilled/cancelled/noshow; RFC 5545: TENTATIVE/CONFIRMED/CANCELLED |
| `personId` | uuid (ref Person) | FHIR Appointment: `subject` (the person the appointment is about, distinct from `participant`) |
| `assignedToId` | uuid (ref User) | FHIR Appointment: `participant` where type = Practitioner; RFC 5545: `ORGANIZER` |
| `notes` | string | FHIR Appointment: `note` (Annotation[]); RFC 5545: `DESCRIPTION` |
| `createdAt` | date-time, readOnly | Universal; FHIR Appointment: `created` |
| `updatedAt` | date-time, readOnly | Universal; required by `api-patterns.yaml` |

**Status values:** `scheduled`, `completed`, `canceled`, `no_show`

- `scheduled` = FHIR `booked`, `completed` = FHIR `fulfilled`, `canceled` = FHIR `cancelled`, `no_show` = FHIR `noshow`
- `no_show` is in the base because FHIR includes it as a core status and SNAP regulations ([7 CFR 273.2](https://www.law.cornell.edu/cfr/text/7/273.2)) require specific handling of missed interviews — this is universal in benefits scheduling

**Key design decisions:**
- `appointmentType` is free-text (string), not an enum — matches FHIR's extensible CodeableConcept pattern. States define their own types via overlay or configuration.
- Both `startAt` and `endAt` are included from day one — both FHIR and iCalendar include start and end as core properties. An appointment without an end time cannot express duration.
- `personId` (subject) and `assignedToId` (practitioner) follow FHIR's separation of subject from participant.

## Future Work

### Schedule

Staff/resource availability windows. Defines time periods a resource is available for booking.

- **Industry source:** [FHIR Schedule](https://hl7.org/fhir/schedule.html) — an actor's availability for a period of time
- Enables self-scheduling: clients see open windows and book within them

### Slot

Bookable time segments within a schedule. The smallest bookable unit — open, booked, or blocked.

- **Industry source:** [FHIR Slot](https://hl7.org/fhir/slot.html) — a time slot within a Schedule
- FHIR's scheduling module uses three entities as a triad: Schedule (availability), Slot (bookable units), Appointment (bookings)

### Not separate entities

| Concept | Rationale | Industry Basis |
|---------|-----------|----------------|
| **Interview** | Modeled as an `appointmentType` value, not a standalone entity. Program-specific context (which program requires it, regulatory citation) belongs in program requirements config. | FHIR has no separate Interview resource. [SNAP interview requirements](https://www.fns.usda.gov/snap/state/interview-toolkit/initiating/scheduling) (7 CFR 273.2) are a program requirement that drives scheduling, not a scheduling entity. |
| **Reminder** | Belongs in the Communication cross-cutting domain, not scheduling. | FHIR handles notifications via Communication resources. RFC 5545 nests VALARM inside VEVENT (not standalone). |

## Contract Artifacts

The scheduling domain is primarily **data-shaped** — most interactions are CRUD on appointments. Behavioral operations (conflict detection, automated reminders, rescheduling workflows) can be added later via state machine contract artifacts.

| Artifact | Status | Notes |
|----------|--------|-------|
| OpenAPI spec | Alpha | `scheduling-openapi.yaml` — Appointment CRUD endpoints |
| State machine YAML | TBD | Appointment lifecycle (e.g., scheduled to completed, canceled, no_show) with guards and effects |
| Rules YAML | TBD | Scheduling rules (e.g., conflict detection, availability matching) |

## Key Design Questions

- **Conflict detection** — Should the API prevent double-booking? If so, as a guard on create/update, or as a separate validation endpoint?
- **Automated reminders** — When an appointment is created, should the system automatically schedule reminders via the Communication domain?
- **Self-scheduling** — How do Schedule and Slot enable client-facing booking? What approval workflow is needed?
- **Rescheduling** — Is rescheduling an update to the existing appointment or a cancel-and-create pattern? FHIR supports both.
- **No-show handling** — What automated actions follow a no_show status? SNAP requires rescheduling within the 30-day processing period.

## Related Documents

| Document | Description |
|----------|-------------|
| [Domain Design](../domain-design.md) | Scheduling section in the domain overview |
| [Case Management](case-management.md) | Staff assignments — closely related domain |
| [Workflow](workflow.md) | Task lifecycle — appointments may trigger tasks |
| [Communication](../cross-cutting/communication.md) | Reminders and notifications belong here |
| [Contract-Driven Architecture](../contract-driven-architecture.md) | Contract artifacts and the adapter pattern |
