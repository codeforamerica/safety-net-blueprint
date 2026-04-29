# Document Management Domain

This document covers the design of the document management domain in the Safety Net Blueprint. Vendor comparisons draw on Gartner Magic Quadrant leaders for content services — Microsoft SharePoint/Purview, OpenText (including Documentum), Hyland OnBase, IBM FileNet/IER, Laserfiche, M-Files, and Box — along with case management platforms IBM Cúram and Salesforce Government Cloud. Records management standards referenced include ISO 15489:2016 and DoD 5015.2.

## Overview

The document management domain is the central store for uploaded files and their metadata across all safety net programs. It manages the physical receipt, versioning, storage, and records lifecycle of documents submitted as evidence — pay stubs, citizenship certificates, utility bills, lease agreements, and similar verification materials. It produces events that other domains consume to track whether a required document has been received, but it does not determine whether a document is sufficient, accurate, or satisfies any program requirement — those determinations belong to the domains that subscribed to those events.

## What happens during document management

1. A document record is created, establishing a logical container with a type, title, and correlation metadata linking it to the relevant application or case.
2. A file is uploaded and attached to the document record as its first version.
3. If a document needs to be replaced or corrected, a new version is uploaded. Each upload produces a new version record; previous versions are preserved.
4. A document may be linked to multiple applications or cases, enabling cross-program reuse without duplication.
5. When associated applications or cases close, the document's retention clock starts. The clock trigger and retention period are determined by the document type.
6. At the end of the retention period, the document enters review for disposition.
7. Documents under legal hold are excluded from disposition regardless of retention status.
8. Eligible documents are destroyed according to the disposition decision.

## Regulatory requirements

### Retention periods

| Program | Minimum retention | Citation | Notes |
|---|---|---|---|
| SNAP | 3 years from program year close | 7 CFR § 272.1(f) | Federal floor; states may require longer |
| Medicaid | 6 years from date of service | 45 CFR § 164.530(j) | HIPAA medical records floor |
| Medicaid estate recovery | Indefinite | 42 CFR § 433.36 | Hold until estate claim is resolved |

### HIPAA requirements

Documents containing protected health information — common in Medicaid, CHIP, and long-term care applications — must meet HIPAA technical safeguard requirements for access controls, audit controls, and integrity (45 CFR § 164.312). The document management domain provides the audit trail and access event record; encryption at rest and in transit is a storage adapter concern.

### Records management standards

ISO 15489:2016 defines the properties of trustworthy records (authenticity, reliability, integrity, usability) and is the international guidance standard for records management programs. It is not a certifiable standard. DoD 5015.2 is the operative certification standard for US government records management systems — it requires the active → retained → pending_disposition → destroyed lifecycle, disposition workflows, and legal hold controls. See [Decision 5](#decision-5-records-lifecycle-model).

## Entity model

### Document

The primary entity — a logical container representing a document across all its versions. A document has a type, a title, and opaque correlation metadata passed by the uploading caller. It does not contain the file itself.

Key fields:
- `id` — UUID
- `documentTypeId` — FK to DocumentType; drives retention schedule and display label
- `title` — human-readable label set by the uploading caller (e.g., "John Smith — Pay Stub March 2026"), distinct from the upload filename; standard across Salesforce ContentDocument, FileNet DocumentTitle, M-Files Name/Title, and SharePoint Title column
- `metadata` — opaque JSON; uploading caller passes correlation IDs (e.g., application or verification references); stored and echoed in events without interpretation. See [Decision 2](#decision-2-context-pass-through-model).
- `lifecycleState` — records management lifecycle state. See [Document lifecycle](#document-lifecycle).
- `legalHold` — boolean; orthogonal to lifecycle state; required by DoD 5015.2 and present on all compliant platforms. See [Decision 5](#decision-5-records-lifecycle-model).
- `latestVersionId` — FK to the most recent DocumentVersion; single source of truth for current version. See [Decision 1](#decision-1-two-level-document-model).
- `retentionDeadline` — ISO timestamp computed when the document enters `retained` state: `max(DocumentLink.closedAt) + DocumentType.retentionYears`; used as the `relativeTo` anchor for the state machine's timer transition to `pending_disposition`; null while active

All major ECM platforms have an equivalent "document object" concept: SharePoint SPFile parent, Box File, Salesforce ContentDocument, Documentum SysObject, FileNet document class, Laserfiche entry.

### DocumentVersion

An immutable record of a specific file upload. Each upload creates a new version; previous versions are preserved. The physical file bytes are stored in the storage backend.

Key fields:
- `id` — UUID
- `documentId` — FK to parent Document
- `versionNumber` — sequential integer assigned on creation; enables ordering and audit references (e.g., "version reviewed at determination was v2"); all major ECM platforms track an equivalent sequence number
- `fileName` — original filename as uploaded; distinct from `Document.title`, which is the caseworker-assigned label; needed for download and display
- `mimeType` — MIME type of the uploaded file; required to set the correct `Content-Type` header on delivery and to gate accepted file types
- `sizeBytes` — file size in bytes; supports storage quota management and upload validation
- `uploadedById` — identity of the uploader; required by HIPAA (45 CFR § 164.312) for access audit and by DoD 5015.2 for records chain of custody
- `createdAt` — upload timestamp; the authoritative record of when the file was received, independent of storage backend metadata

See [Decision 1](#decision-1-two-level-document-model). All major ECM platforms have an equivalent versioning concept: SharePoint SPFile versions, Box FileVersion, Salesforce ContentVersion, Documentum version labels, FileNet version series, Laserfiche version entry.

### DocumentType

A config-managed entity defining the category and retention rules for a class of documents (e.g., "proof of income — SNAP", "birth certificate", "lease agreement"). Baseline types are seeded via configuration; states add program-specific types at runtime. See [Decision 4](#decision-4-documenttype-as-config-managed-resource).

Key fields:
- `id` — UUID
- `name` — human-readable label
- `source` — `system` (config-seeded, cannot be deleted via API) or `user` (runtime-created via POST); uses the blueprint's `config_managed_resources` pattern. See [Decision 4](#decision-4-documenttype-as-config-managed-resource).
- `retentionYears` — configurable retention period; federal floor is 3 years (7 CFR § 272.1(f)); Medicaid-related types may require 6+ years (45 CFR § 164.530(j)); per-type configuration follows the Laserfiche and OnBase record series model
- `retentionTrigger` — the condition that starts the retention clock for this document type (e.g., `case_closure`, `application_denial`, `document_date`, `submission_date`); equivalent to the "cutoff instruction" in DoD 5015.2 terminology; stored as data so states configure it without modifying the state machine

### DocumentLink

A junction entity recording that a document is associated with a subject (e.g., an application or case). Enables cross-program reuse — a single document can satisfy obligations for multiple programs. See [Decision 3](#decision-3-document-subject-association-model).

Key fields:
- `id` — UUID
- `documentId` — FK to Document
- `subjectType` — polymorphic discriminator identifying what the document is linked to (e.g., `application`, `case`); same pattern as `Task.subjectType` in the workflow domain; states extend the enum via overlay to add program-specific subject types (e.g., `appeal`, `redetermination`, `member`)
- `subjectId` — UUID of the associated subject; resolved conditionally based on `subjectType`
- `linkedBy` — identity of who created the link; audit trail for document association (required for HIPAA chain-of-custody)
- `createdAt`
- `closedAt` — null while the subject is open; set when the subject closes; retention clock starts from this value per `DocumentType.retentionTrigger`; a document linked to multiple subjects uses the latest `closedAt` across all links as the clock start

## Document lifecycle

### States

| State | Description | SLA clock |
|---|---|---|
| `active` | Document is in active use and available for access | — |
| `retained` | All associated subjects are closed; retention period is running | Running from `DocumentLink.closedAt` per `DocumentType.retentionTrigger` |
| `pending_disposition` | Retention period has elapsed; document awaits disposition decision | — |
| `destroyed` | Document has been disposed of; file bytes purged from storage | — |

### Key transitions

- **created → active** — document record created; first version upload advances it to active
- **all subjects close → retained** — all linked `DocumentLink.closedAt` values are set; retention clock starts. See [Decision 3](#decision-3-document-subject-association-model).
- **retention period elapsed → pending_disposition** — timer transition in the state machine fires at `retentionDeadline` (`after: 0h, relativeTo: retentionDeadline`) when `legalHold` is false; same pattern as workflow SLA timer transitions
- **disposition approved → destroyed** — a records manager calls `POST /documents/{documentId}/approve-disposition`; document and all versions are purged from storage and a destruction audit event is emitted
- **legalHold = true** — blocks advancement from `active` or `retained` regardless of retention schedule; document stays in its current state until hold is lifted. See [Decision 5](#decision-5-records-lifecycle-model).

## SLA and deadline management

Retention deadlines are not SLA types in the workflow sense — they are regulatory schedule dates computed per document. `DocumentType.retentionTrigger` determines when the clock starts; `DocumentLink.closedAt` provides the trigger event timestamp; `DocumentType.retentionYears` defines the deadline.

When `retentionDeadline` is reached and `legalHold` is false, the state machine's timer transition advances the document to `pending_disposition`. `retentionDeadline` is computed and stored on the `Document` when it enters `retained` state, using `X-Mock-Now` for test simulation — the same pattern as workflow SLA deadline timers.

There are no inbound SLAs for upload or retrieval — performance targets are a storage adapter concern.

## Domain events

### Event types

The document management domain emits events across four categories: document and version lifecycle, records management lifecycle, access audit, and legal hold. All events carry the document's opaque correlation metadata, enabling consumers to correlate without knowing the document management internals.

### Event catalog

| Event | Why it's needed | Trigger | Primary consumers |
|---|---|---|---|
| `document_management.document.created` | Notifies that a document record is established and ready to receive uploads; allows consumers to correlate the new document ID with their own context | Document created via `POST /documents` | Case management, intake |
| `document_management.document_version.uploaded` | Notifies that a file is available; carries correlation metadata back to the submitting caller so consumers can update obligation status or route review work | Version uploaded via `POST /documents/{id}/document-versions` | Intake (rules engine updates matching Verification record), workflow (triggers caseworker review task) |
| `document_management.document_version.accessed` | Required by HIPAA (45 CFR § 164.312) for access audit; records who accessed which version and when regardless of delivery mode | Content endpoint called via `GET /document-versions/{id}/content` | Compliance reporting, audit |
| `document_management.document.retained` | Notifies that a document has entered the retention period; allows consumers to update case or application records to reflect the document is no longer in active use | All associated subjects closed; `active → retained` transition | Case management, reporting |
| `document_management.document.pending_disposition` | Notifies that the retention deadline has elapsed and the document is awaiting disposition review; drives records manager notification and review queue | Timer transition fires at `retentionDeadline` | Records management UI, reporting |
| `document_management.document.destroyed` | Required for DoD 5015.2 destruction certificate and compliance reporting; allows consumers to clean up any references to the destroyed document | `POST /documents/{id}/approve-disposition` | Compliance reporting, case management |
| `document_management.document.legal_hold_placed` | Notifies that a document has been placed under legal hold and will not advance through the retention lifecycle; standard in all DoD 5015.2 compliant platforms | `legalHold` set to `true` | Legal, compliance, case management |
| `document_management.document.legal_hold_released` | Notifies that the legal hold has been lifted; document may now resume normal retention lifecycle | `legalHold` set to `false` | Legal, compliance, case management |

## Contract artifacts

| Artifact | File |
|---|---|
| OpenAPI spec | `document-management-openapi.yaml` |
| State machine | `document-management-state-machine.yaml` |

## Key design decisions

| # | Decision | Summary |
|---|---|---|
| 1 | [Two-level document model](#decision-1-two-level-document-model) | `Document` + `DocumentVersion` rather than a flat file entity. |
| 2 | [Context pass-through model](#decision-2-context-pass-through-model) | Opaque `metadata` field stores and echoes correlation IDs without interpretation. |
| 3 | [Document-subject association model](#decision-3-document-subject-association-model) | `DocumentLink` junction entity with `closedAt` for cross-program reuse and retention management. |
| 4 | [DocumentType as config-managed resource](#decision-4-documenttype-as-config-managed-resource) | Per-type retention configuration using the `config_managed_resources` pattern. |
| 5 | [Legal hold modeling](#decision-5-legal-hold-modeling) | `legalHold` boolean is orthogonal to the lifecycle — consistent with all major records management vendors. |
| 6 | [File retrieval model](#decision-6-file-retrieval-model) | Both proxy and redirect responses documented; proxy is the default; states switch via overlay. |

---

### Decision 1: Two-level document model

**Status:** Decided: B

**What's being decided:** Whether the domain models files as a flat "file" entity or as a two-level document + version hierarchy.

**Considerations:**
- All major ECM platforms use a two-level model: SharePoint (SPFile + version history), Box (File + FileVersion), Salesforce (ContentDocument + ContentVersion), OpenText Documentum (SysObject + version labels), IBM FileNet (document class + version series), Laserfiche (entry + version), Hyland OnBase (document type + revision). Flat models appear only in blob storage services (S3, Azure Blob) that provide no document management semantics.
- Cross-program reuse — a pay stub uploaded for SNAP also satisfying a Medicaid income verification — requires a stable document identity that persists across uploads. A flat model has no concept of "this file replaces that file."
- Regulatory audit requirements (7 CFR § 272.1, 45 CFR § 164.312) require knowing which version was reviewed at the time of a determination. A per-upload version record provides this without relying on storage metadata.
- `Document.latestVersionId` is the single source of truth for the current version, using the `x-relationship` expand pattern so consumers control how much version detail to embed inline.

**Options:**
- **(A)** Flat file model — one entity per upload, no document concept
- **(B)** ✓ Two-level model — `Document` (logical, stable identity) + `DocumentVersion` (physical, immutable per upload)

---

### Decision 2: Context pass-through model

**Status:** Decided: B

**What's being decided:** How document management relates to the domains that submit documents — whether it interprets correlation data or stores and echoes it opaquely.

**Considerations:**
- When a document is uploaded, downstream systems need to know what it is for. Intake must identify which verification obligation the upload satisfies; workflow must know which case or application to route a review task against; HIPAA access audit events (45 CFR § 164.312) must record business context alongside the access. Without correlation data on the document, the `document_version.uploaded` event is context-free — consumers have no way to act on it without a separate lookup that requires them to understand document management internals.
- Documents are submitted in the context of a verification obligation, a case task, or a direct caseworker upload. Document management should not need to know the business meaning of each context — typed FK fields for `verificationId`, `taskId`, etc. would create tight coupling to other domains and break when new contexts are added.
- Box, Dropbox, and SharePoint all support opaque metadata bags on file objects; Documentum uses aspect metadata. None require the document management service itself to understand the business context of what is stored.
- The correlation pass-through pattern is established in event-driven architectures: a service stores the context it was given and echoes it in events, allowing the originating domain to correlate without imposing semantic requirements on the storage layer.

**Options:**
- **(A)** Domain-aware — typed FK fields (`verificationId`, `taskId`) on Document
- **(B)** ✓ Context pass-through — `metadata` is an opaque JSON object; callers provide correlation IDs; document management stores and echoes them in events unchanged

---

### Decision 3: Document-subject association model

**Status:** Decided: B

**What's being decided:** How documents are associated with the subjects they support across domains, and how those associations drive retention clocks.

**Considerations:**
- FNS policy supports reuse of documents across programs in a single application and across a household's applications over time. A model where each document belongs to exactly one application cannot support reuse without duplication — which creates retention management problems (which copy starts the clock?) and unnecessary storage cost.
- IBM FileNet IER uses "containment relationships" (a document can be contained by multiple case objects). Laserfiche uses a folder/shortcut model for cross-case sharing. Hyland OnBase uses document-to-case link tables. All major government ECM platforms converge on a junction or link model for this reason.
- `DocumentLink.closedAt` is the trigger for the retention clock: when a subject closes, the system sets `closedAt` on all associated links. For documents linked to multiple subjects, each link has its own `closedAt`. Retention starts from the latest `closedAt` across all links — the document is retained until all associated subjects are closed.

**Options:**
- **(A)** Direct FK on Document — `document.applicationId` or `document.caseId`; one subject per document
- **(B)** ✓ `DocumentLink` junction entity with `closedAt` — many-to-many with per-link retention tracking

---

### Decision 4: DocumentType as config-managed resource

**Status:** Decided: C

**What's being decided:** Whether document types are hardcoded in the contract, runtime-created via API only, or a mix of config-seeded and runtime-created.

**Considerations:**
- Baseline types (pay stub, bank statement, birth certificate, lease agreement, utility bill) are common across states and programs. Seeding them via configuration provides a consistent starting point.
- States need to add program-specific types (tribal enrollment documents, state-specific income verification forms, etc.) without requiring a contract change.
- The blueprint's `config_managed_resources` pattern (defined in `api-patterns.yaml`) uses a `source` field (`system` vs. `user`) to distinguish seeded from runtime-created entities and gates deletion accordingly. This pattern is already established for other config-managed resources.
- Per-type retention configuration follows the Laserfiche and Hyland OnBase model — each record type carries its own retention schedule rather than relying on a global default.

**Options:**
- **(A)** Hardcoded enum — document types are a fixed contract enum
- **(B)** Runtime-only — all types created via API, none seeded
- **(C)** ✓ Config-managed — baseline types seeded via `document-management-config.yaml`; states add more at runtime; `source` field distinguishes them; per-type `retentionYears` and `retentionTrigger`

---

### Decision 5: Legal hold modeling

**Status:** Decided: B

**What's being decided:** Whether legal hold is modeled as a lifecycle state or as an orthogonal flag independent of the document lifecycle.

**Background:** DoD 5015.2 and all five major records management vendors (Laserfiche, Hyland OnBase, OpenText, IBM FileNet/IER, Microsoft Purview) converge on the same four-state lifecycle: active → retained → pending_disposition → destroyed. The naming varies — Purview uses "active/expired/pending disposal/deleted"; Laserfiche uses "active/cutoff/eligible for disposal/destroyed" — but the states are structurally identical. This lifecycle is not a decision point; it is the industry standard required by DoD 5015.2. The decision is how legal hold interacts with it.

**Considerations:**
- DoD 5015.2 requires hold management that suspends normal disposition. OpenText (Documentum) and IBM FileNet/IER are DoD 5015.2 certified; Laserfiche and Hyland OnBase meet the functional requirements without formal certification.
- No major vendor treats legal hold as a lifecycle state. All implement it as an orthogonal flag that overrides the normal lifecycle — an object on legal hold can still be in `retained` state; the hold prevents advancement to disposition until lifted.
- Medicaid estate recovery (42 CFR § 433.36) requires indefinite retention, handled by setting a very long `retentionYears` or using `document_date` as the trigger on the applicable document type.

**Options:**
- **(A)** Integrated legal hold state — legal hold is a lifecycle state (e.g., `active → legal_hold → retained → ...`)
- **(B)** ✓ Orthogonal boolean — `legalHold: boolean` is independent of lifecycle; `active → retained → pending_disposition → destroyed` with `legalHold` gating disposition

---

### Decision 6: File retrieval model

**Status:** Decided: C

**What's being decided:** How consumers download file bytes — proxied through the API, redirected to storage via signed URL, or both.

**Considerations:**
- Proxied delivery (API streams bytes): full auth enforcement on every request, storage backend not exposed to clients, download auditable at API layer. Higher server load and latency.
- Redirect delivery (302 to signed URL): direct client-to-storage download, lower API server load. Exposes storage bucket name and cloud provider to clients. Signed URL can be forwarded and used within its expiry window (typically 5–15 minutes) without re-authenticating to the API.
- Box implements direct download via signed URL, logging URL issuance as the audit event. SharePoint and OnBase support both modes. Government deployments typically default to proxied for security posture.
- The audit event fires when `GET /document-versions/{id}/content` is called regardless of response type — the authorization event is captured at API layer in both modes.
- For a blueprint targeting diverse state infrastructure (S3, Azure Blob, on-prem), delivery strategy is adapter-specific. Both response shapes should be documented so clients handle either.

| | Proxy (`200`) | Redirect (`302`) |
|---|---|---|
| Audit | API logs every download attempt | API logs URL issuance; actual download unobserved |
| Storage exposure | None | Bucket name and provider visible to client |
| Link forwarding | Not possible | Possible within expiry window |
| Performance | API is in the data path | Client downloads directly from storage |
| Default | ✓ | Opt-in via overlay |

**Options:**
- **(A)** Proxy only
- **(B)** Redirect only
- **(C)** ✓ Contract-neutral — both `200` (binary stream) and `302` (redirect) documented as valid responses on `GET /document-versions/{id}/content`; proxy is the default; states switch to redirect by adding `x-content-delivery: redirect` to the content operation via overlay

---

## Customization

### Baseline constraints

The following should not be removed or overlaid away:

| Element | Reason | Decision |
|---|---|---|
| `active → retained → pending_disposition → destroyed` lifecycle states | Required for DoD 5015.2 compliance | [Decision 5](#decision-5-legal-hold-modeling) |
| `legalHold` boolean | Required for DoD 5015.2 hold management | [Decision 5](#decision-5-legal-hold-modeling) |
| Two-level `Document` + `DocumentVersion` structure | Foundation of versioning and cross-program reuse | [Decision 1](#decision-1-two-level-document-model) |

### Document types

States configure baseline document types in a `document-management-config.yaml` deployment artifact. Each type specifies `retentionYears` and `retentionTrigger`. States with longer retention requirements (e.g., Medicaid estate recovery) set an appropriate `retentionYears` value or use `document_date` as the trigger for documents without a clear closure event. States can also create additional document types at runtime via the API; runtime-created types are marked `source: user` and can be deleted, unlike config-seeded types.

### Entity fields

States can add fields to Document, DocumentVersion, DocumentType, and DocumentLink via overlay. States that need typed access to correlation data (rather than opaque JSON) can add structured metadata fields to Document via overlay.

### File retrieval delivery mode

The content endpoint defaults to proxy delivery (`200` with streamed bytes). States switch to redirect delivery (`302` to a signed storage URL) by adding an overlay that sets `x-content-delivery: redirect` on the `GET /document-versions/{id}/content` operation. The adapter reads this extension at startup. Both response shapes are already documented in the OpenAPI spec, so clients handle either without contract changes. See [Decision 6](#decision-6-file-retrieval-model) for the full trade-off analysis.

### State machine

States can extend the document lifecycle via overlay — adding custom states, transitions, or guards.

## Out of scope

| Capability | Domain | Notes |
|---|---|---|
| Virus scanning / malware detection | Storage adapter | Pre-upload scanning is a storage infrastructure concern |
| OCR / content extraction | Data exchange | Text extraction and structured data production from documents |
| Verification sufficiency decisions | Intake | Whether a document satisfies a verification obligation is an intake rules concern |
| Eligibility determination | Eligibility | Document content does not feed directly into eligibility logic |
| Caseworker review workflow | Workflow | Creating and routing review tasks in response to document uploads |
| Case file assembly | Case management | Organizing documents into a case record view |
| E-signature | Adapter layer | Out of scope for the baseline blueprint |
| Bulk document import | Not in scope | Batch import from legacy systems is not a baseline capability |

## Capability coverage

### Document creation and versioning

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Document creation with metadata | All major platforms | **Planned** |
| Version history (immutable per upload) | All major platforms | **Planned** |
| Version restore | Enterprise ECM (Documentum, FileNet) | **Gap** — not yet assessed |
| Concurrent edit locking | Documentum, FileNet, OnBase | **Not in scope** |

### Cross-program reuse

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Document sharing across subjects | Laserfiche, FileNet IER, OnBase | **Planned** — DocumentLink model |
| Duplicate detection | M-Files, OpenText | **Not in scope** |

### Records management

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Per-type retention scheduling | OnBase, Laserfiche, OpenText | **Planned** — DocumentType.retentionYears / retentionTrigger |
| Legal hold | All DoD 5015.2 platforms | **Planned** — legalHold boolean |
| Disposition approval (per document) | DoD 5015.2 requirement | **Planned** — `POST /documents/{id}/approve-disposition` RPC endpoint |
| Bulk disposition approval | Laserfiche, OnBase batch review | **Gap** — batch endpoint not in baseline; tracked as future work |
| Destruction audit | DoD 5015.2 requirement | **Planned** — via events |

### Access and audit

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Document access audit trail | HIPAA, DoD 5015.2 | **Planned** — event on content request |
| Role-based access control | All major platforms | **Adapter layer** |
| Document-level ACLs | Enterprise ECM | **Adapter layer** |

### File delivery

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Proxied download (secure default) | Government deployments | **Planned** |
| Redirect to signed URL (performance opt-in) | Box, S3-backed ECM | **Planned** — opt-in via overlay |
| Chunked / resumable upload | S3 multipart, Azure Blob | **Adapter layer** |

### Integration

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Event emission on upload | Box, SharePoint/Graph, modern ECM | **Planned** — document_version.uploaded event |
| Event emission on document creation | Modern ECM | **Planned** — document.created event |
| Full-text search / OCR | OpenText, FileNet, OnBase | **Not in scope** — data exchange domain |

## References

- 7 CFR § 272.1(f) — SNAP records retention
- 42 CFR § 433.36 — Medicaid estate recovery
- 42 CFR § 435.912 — Medicaid application processing
- 45 CFR § 164.312 — HIPAA technical safeguards
- 45 CFR § 164.530(j) — HIPAA medical records retention
- DoD 5015.2 — Design Criteria Standard for Electronic Records Management Software Applications
- ISO 15489:2016 — Information and documentation — Records management
- [Intake domain architecture](intake.md)
- [Case management domain architecture](case-management.md)
- [Contracts package restructure ADR](../decisions/contracts-package-restructure.md)
- [x-extensions reference](../x-extensions.md)
