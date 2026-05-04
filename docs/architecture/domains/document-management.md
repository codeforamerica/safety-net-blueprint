# Document Management Domain

This document covers the design of the document management domain in the Safety Net Blueprint. Vendor comparisons draw on Gartner Magic Quadrant leaders for content services — Microsoft SharePoint/Purview, OpenText (including Documentum), Hyland OnBase, IBM FileNet/IER, Laserfiche, M-Files, and Box — along with case management platforms IBM Cúram and Salesforce Government Cloud. Records management standards referenced include ISO 15489:2016 and DoD 5015.2.

## Overview

The document management domain is the central store for uploaded files and their metadata across all safety net programs. It manages the physical receipt, versioning, storage, and records lifecycle of documents submitted as evidence — pay stubs, citizenship certificates, utility bills, lease agreements, and similar verification materials. It produces events that other parts of the system use to track whether a required document has been received, but it does not determine whether a document is sufficient, accurate, or satisfies any program requirement — those determinations belong to the domains that manage those assessments.

## What happens during document management

1. A document is uploaded, creating a record with a type and title alongside its first version. See [Decision 9](#decision-9-document-creation-model).
2. If a document needs to be replaced or corrected, a new version is uploaded. Each upload produces a new version record; previous versions are preserved.
3. A document may be linked to any number of program records — applications, cases, appeals, and others — enabling the same document to serve multiple programs without duplication.
4. When the retention trigger condition is met — determined by the document type — the document's retention period begins. Federal regulations set minimum periods that documents must be kept after the triggering event before they are eligible for destruction (7 CFR § 272.1(f), 45 CFR § 164.530(j)).
5. At the end of the retention period, the document enters review for disposition.
6. Documents under legal hold are excluded from disposition regardless of retention status.
7. Eligible documents are destroyed according to the disposition decision.

## Regulatory requirements

### Retention periods

| Program | Minimum retention | Citation | Notes |
|---|---|---|---|
| SNAP | 3 years from program year close | 7 CFR § 272.1(f) | Federal floor; states may require longer |
| Medicaid | 6 years from date of service | 45 CFR § 164.530(j) | HIPAA medical records floor |
| Medicaid estate recovery | Indefinite | 42 CFR § 433.36 | Hold until estate claim is resolved |

### HIPAA requirements

Documents containing protected health information — common in Medicaid, CHIP, and long-term care applications — must meet HIPAA technical safeguard requirements for access controls, audit controls, and integrity (45 CFR § 164.312). The document management domain provides the audit trail and access event record; encryption at rest and in transit is handled by the storage layer.

### Records management standards

ISO 15489:2016 defines the properties of trustworthy records (authenticity, reliability, integrity, usability) and is the international guidance standard for records management programs. It is not a certifiable standard. DoD 5015.2 is the operative certification standard for US government records management systems — it requires the active → retained → pending_disposition → destroyed lifecycle, disposition workflows, and legal hold controls. See [Decision 5](#decision-5-legal-hold-modeling).

## Entity model

### Document

The core record representing a document across all its versions. It holds the document's identity, type, and the correlation context callers have attached; the actual file content is stored in DocumentVersion records. See [Decision 1](#decision-1-two-level-document-model) for why a two-level model is used.

Key fields:
- `id` — UUID
- `documentTypeId` — links to the DocumentType for this document; determines the retention period and which event starts the retention clock
- `title` — human-readable label set by the uploading caller (e.g., "John Smith — Pay Stub March 2026"), distinct from the upload filename; standard across Salesforce ContentDocument, FileNet DocumentTitle, M-Files Name/Title, and SharePoint Title column
- `documentDate` — optional ISO date representing the document's own date (e.g., the date printed on a pay stub or bank statement); set by the uploading caller; required when `DocumentType.retentionTrigger = document_date`; distinct from `DocumentVersion.createdAt`, which is the upload timestamp
- `metadata` — a JSON object that callers use to pass correlation context (e.g., an application ID, a verification reference, an e-signature envelope ID); stored and echoed in events without interpretation, so downstream systems can correlate the document with their own records without querying this domain; structured as nested objects keyed by domain name (`{ "intake": { "verificationId": "..." } }`) so each caller manages its own namespace without overwriting another's context. See [Decision 2](#decision-2-context-pass-through-model) and [Decision 12](#decision-12-metadata-mutability-and-update-model).
- `lifecycleState` — where the document is in its records management lifecycle; determines whether the document is accessible, whether retention rules apply, and whether it is eligible for disposition; required by DoD 5015.2. See [Document lifecycle](#document-lifecycle).
- `legalHold` — true/false flag, independent of lifecycle state; prevents the document from advancing to disposition until the hold is lifted, regardless of where it is in the retention schedule; required by DoD 5015.2 and implemented the same way on all major compliant platforms. See [Decision 5](#decision-5-legal-hold-modeling).
- `latestVersionId` — links to the most recent DocumentVersion; provides a single authoritative pointer to the current file so consumers do not need to sort version history to find it. See [Decision 1](#decision-1-two-level-document-model).
- `retentionDeadline` — the date when the retention period ends, computed when the document enters `retained` state as the trigger event timestamp plus `DocumentType.retentionYears`; the trigger timestamp varies by `DocumentType.retentionTrigger` (see [Document lifecycle](#document-lifecycle) for details); stored so the system can automatically advance the document to `pending_disposition` when the deadline passes without requiring a manual check; null until the document enters `retained` state
- `dispositionApprovedBy` — identity of the records manager who authorized destruction; required by DoD 5015.2 for the destruction certificate; null until the document enters `destroyed` state. See [Decision 11](#decision-11-destruction-scope-and-metadata-retention).
- `dispositionApprovedAt` — when destruction was authorized; the definitive date for the destruction certificate, distinct from `updatedAt` which is a generic last-modified timestamp; null until the document enters `destroyed` state. See [Decision 11](#decision-11-destruction-scope-and-metadata-retention).

All major ECM platforms have an equivalent "document object" concept: SharePoint SPFile parent, Box File, Salesforce ContentDocument, Documentum SysObject, FileNet document class, Laserfiche entry.

### DocumentVersion

An immutable record of a specific file upload. Each upload creates a new version; previous versions are preserved so caseworkers can see which file was current at any point in time and auditors can verify which version was reviewed at a benefits determination (7 CFR § 272.1, 45 CFR § 164.312). The file bytes are stored in the storage backend.

Key fields:
- `id` — UUID
- `documentId` — links to the parent Document; ties this version to its document record so all versions of the same document are accessible together
- `versionNumber` — sequential integer assigned on creation; enables ordering and audit references (e.g., "version reviewed at determination was v2"); all major ECM platforms track an equivalent sequence number
- `fileName` — original filename as uploaded; distinct from `Document.title`, which is the caseworker-assigned label; needed for download and display
- `mimeType` — MIME type of the uploaded file; required to set the correct `Content-Type` header on delivery and to gate accepted file types
- `sizeBytes` — file size in bytes; supports storage quota management and upload validation
- `uploadedById` — identity of the uploader; required by HIPAA (45 CFR § 164.312) for access audit and by DoD 5015.2 for records chain of custody
- `createdAt` — upload timestamp; the authoritative record of when the file was received, independent of storage backend metadata
- `contentHash` — SHA-256 hash of the file bytes; computed on upload. See [Decision 7](#decision-7-duplicate-detection).

See [Decision 1](#decision-1-two-level-document-model). All major ECM platforms have an equivalent versioning concept: SharePoint SPFile versions, Box FileVersion, Salesforce ContentVersion, Documentum version labels, FileNet version series, Laserfiche version entry.

### DocumentType

Defines the category and retention rules for a class of documents (e.g., "proof of income — SNAP", "birth certificate", "lease agreement"). Determines how long documents of that type must be kept and what event starts the retention clock. Baseline types are loaded from a configuration file; states add program-specific types via the API. See [Decision 4](#decision-4-documenttype-as-config-managed-resource).

Key fields:
- `id` — UUID
- `name` — human-readable label
- `source` — `system` (loaded from the baseline configuration, cannot be deleted via API) or `user` (created by states via the API); distinguishes baseline types from state-added types so only user-created types can be deleted. See [Decision 4](#decision-4-documenttype-as-config-managed-resource).
- `retentionYears` — configurable retention period; federal floor is 3 years (7 CFR § 272.1(f)); Medicaid-related types may require 6+ years (45 CFR § 164.530(j)); per-type configuration follows the Laserfiche and OnBase record series model
- `retentionTrigger` — the event that starts the retention clock for this document type (e.g., `case_closure`, `application_denial`, `document_date`, `submission_date`); different document types have different regulatory anchors — a pay stub's retention period starts when the case closes, while a document with a specific date on its face may start from that date; determines which timestamp is used to compute `retentionDeadline`; `document_date` requires `Document.documentDate` to be set at upload time. See [Decision 10](#decision-10-retention-trigger-evaluation-model).

### DocumentLink

Records that a document is associated with an application, case, or other subject. Enables cross-program reuse — a single document can satisfy obligations for multiple programs without being copied — and tracks when each subject closes so the retention clock starts at the right time. See [Decision 3](#decision-3-document-subject-association-model).

Key fields:
- `id` — UUID
- `documentId` — links to the Document this association belongs to
- `subjectType` — identifies what kind of record this document is linked to (e.g., `application`, `case`); used together with `subjectId` to locate the linked record and detect when it closes for closure-based retention triggers; states add program-specific values via overlay (e.g., `appeal`, `redetermination`, `member`)
- `subjectId` — ID of the linked record; the type of record it belongs to is identified by `subjectType`
- `linkedBy` — identity of who created the link; audit trail for document association (required for HIPAA chain-of-custody)
- `createdAt`
- `closedAt` — null while the subject is open; set when the subject closes; used as the trigger event timestamp for `case_closure` and `application_denial` retention triggers; for documents linked to multiple subjects, the latest `closedAt` across all links is used

## Document lifecycle

### States

| State | Description | SLA clock |
|---|---|---|
| `active` | Document is in active use and available for access | — |
| `retained` | Retention trigger has fired; the document is past active use but must be kept for the full retention period before it can be reviewed for destruction — the minimum period is set by federal regulation | Running from trigger event per `DocumentType.retentionTrigger` |
| `pending_disposition` | Retention period has elapsed; the document is held for a records manager to approve or defer destruction — DoD 5015.2 requires this review step before destruction | — |
| `destroyed` | Document has been disposed of; file content is no longer accessible, but the record stays so there is permanent proof of what was destroyed, when, and who authorized it — federal records law requires this evidence to survive the destruction itself. See [Decision 11](#decision-11-destruction-scope-and-metadata-retention). | — |

### Key transitions

- **upload → active** — document and first version created in a single step on upload; document is active immediately. See [Decision 9](#decision-9-document-creation-model).
- **retention trigger fires → retained** — for `case_closure` and `application_denial` triggers: all linked `DocumentLink.closedAt` values are set; for `document_date` and `submission_date` triggers: the configured condition is met; retention clock starts. See [Decision 3](#decision-3-document-subject-association-model).
- **retention period elapsed → pending_disposition** — when `retentionDeadline` is reached and `legalHold` is false, the system automatically moves the document to `pending_disposition`; documents on legal hold remain in `retained` until the hold is lifted
- **disposition approved → destroyed** — a records manager approves disposition via the API; the Document record transitions to `destroyed` and `dispositionApprovedBy` / `dispositionApprovedAt` are set; version metadata is retained as the required audit record of destruction but file content is no longer accessible; physical deletion of file bytes from storage is handled by the storage layer. See [Decision 11](#decision-11-destruction-scope-and-metadata-retention).
- **legalHold = true** — blocks advancement from `active` or `retained` regardless of retention schedule; document stays in its current state until hold is lifted. See [Decision 5](#decision-5-legal-hold-modeling).

## SLA and deadline management

Retention deadlines are date-based regulatory requirements, not performance targets. `DocumentType.retentionTrigger` determines when the clock starts and which timestamp anchors the deadline; `DocumentType.retentionYears` defines the period. See [Document lifecycle](#document-lifecycle) for trigger-specific details.

When `retentionDeadline` is reached and `legalHold` is false, the system automatically advances the document to `pending_disposition`. `retentionDeadline` is computed and stored on the Document when it enters `retained` state so the advancement can happen without a manual check.

There are no inbound deadlines for upload or retrieval — performance targets are handled by the storage layer.

## Domain events

### Event types

The document management domain emits events across four categories: document and version lifecycle, records management lifecycle, access audit, and legal hold. All events carry the document's opaque correlation metadata, enabling consumers to correlate without knowing the document management internals.

### Event catalog

| Event | Why it's needed | Trigger | Primary consumers |
|---|---|---|---|
| `document_management.document.created` | Notifies that a document record is established with its first version; allows consumers to correlate the new document ID with their own context | Document created via `POST /documents` | Case management, intake |
| `document_management.document_version.uploaded` | Notifies that a file is available; carries correlation metadata back to the submitting caller so consumers can update obligation status or route review work | First version via `POST /documents`; subsequent versions via `POST /documents/{documentId}/document-versions` | Intake (rules engine updates matching Verification record), workflow (triggers caseworker review task) |
| `document_management.document_version.accessed` | Required by HIPAA (45 CFR § 164.312) for access audit; records who accessed which version and when regardless of delivery mode | Content endpoint called via `GET /document-versions/{documentVersionId}/content` | Compliance reporting, audit |
| `document_management.document.retained` | Notifies that a document has entered the retention period; allows consumers to update case or application records to reflect the document is no longer in active use | Retention trigger fires; `active → retained` transition | Case management, reporting |
| `document_management.document.pending_disposition` | Notifies that the retention deadline has elapsed and the document is awaiting disposition review; drives records manager notification and review queue | Timer transition fires at `retentionDeadline` | Records management UI, reporting |
| `document_management.document.destroyed` | Required for DoD 5015.2 destruction certificate and compliance reporting; allows consumers to clean up any references to the destroyed document | `POST /documents/{documentId}/approve-disposition` | Compliance reporting, case management |
| `document_management.document.legal_hold_placed` | Notifies that a document has been placed under legal hold and will not advance through the retention lifecycle; standard in all DoD 5015.2 compliant platforms | `legalHold` set to `true` | Legal, compliance, case management |
| `document_management.document.legal_hold_released` | Notifies that the legal hold has been lifted; document may now resume normal retention lifecycle | `legalHold` set to `false` | Legal, compliance, case management |

## Contract artifacts

| Artifact | File |
|---|---|
| OpenAPI spec | `document-management-openapi.yaml` |
| State machine | `document-management-state-machine.yaml` |
| Document type configuration | `document-management-config.yaml` |

## Key design decisions

| # | Decision | Summary |
|---|---|---|
| 1 | [Two-level document model](#decision-1-two-level-document-model) | `Document` + `DocumentVersion` rather than a flat file entity. |
| 2 | [Context pass-through model](#decision-2-context-pass-through-model) | Opaque `metadata` field stores and echoes correlation IDs without interpretation. |
| 3 | [Document-subject association model](#decision-3-document-subject-association-model) | `DocumentLink` junction entity with `closedAt` for cross-program reuse and retention management. |
| 4 | [DocumentType as config-managed resource](#decision-4-documenttype-as-config-managed-resource) | Per-type retention configuration using the `config_managed_resources` pattern. |
| 5 | [Legal hold modeling](#decision-5-legal-hold-modeling) | `legalHold` boolean is orthogonal to the lifecycle — consistent with all major records management vendors. |
| 6 | [File retrieval model](#decision-6-file-retrieval-model) | Both proxy and redirect responses documented; proxy is the default; states switch via overlay. |
| 7 | [Duplicate detection](#decision-7-duplicate-detection) | Store `contentHash` on DocumentVersion; no response behavior in baseline. |
| 8 | [Virus scanning model](#decision-8-virus-scanning-model) | Synchronous blocking by default — upload returns 422 if scan rejects. |
| 9 | [Document creation model](#decision-9-document-creation-model) | Document and first version are created atomically; upload is the creation event. |
| 10 | [Retention trigger evaluation model](#decision-10-retention-trigger-evaluation-model) | `retentionTrigger` stored as data on DocumentType; state machine evaluates it generically. |
| 11 | [Destruction scope and metadata retention](#decision-11-destruction-scope-and-metadata-retention) | Document and DocumentVersion records retained in `destroyed` state after destruction; content inaccessible via API. |
| 12 | [Metadata mutability and update model](#decision-12-metadata-mutability-and-update-model) | Metadata is mutable via namespace-level PUT/DELETE endpoints; each domain owns its sub-object; no operation touches another caller's namespace. |

---

### Decision 1: Two-level document model

**Status:** Decided: B

**What's being decided:** How to model documents given that the same file is shared across programs and agencies must be able to trace which version existed when a benefits decision was made.

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

**What's being decided:** How to pass "this document is for application X" along to the systems that need to act on it, without the document store needing to know what applications, cases, or other program records are.

**Considerations:**
- When a document is uploaded, downstream systems need to know what it is for. Intake must identify which verification obligation the upload satisfies; workflow must know which case or application to route a review task against; HIPAA access audit events (45 CFR § 164.312) must record business context alongside the access. Without correlation data on the document, the `document_version.uploaded` event is context-free — consumers have no way to act on it without a separate lookup that requires them to understand document management internals.
- Documents are submitted in the context of a verification obligation, a case task, or a direct caseworker upload. Document management should not need to know the business meaning of each context — typed FK fields for `verificationId`, `taskId`, etc. would create tight coupling to other domains and break when new contexts are added.
- Box, Dropbox, and SharePoint all support opaque metadata bags on file objects; Documentum uses aspect metadata. None require the document management service itself to understand the business context of what is stored.
- The correlation pass-through pattern is established in event-driven architectures: a service stores the context it was given and echoes it in events, allowing the originating domain to correlate without imposing semantic requirements on the storage layer.
- Keys within `metadata` are structured as nested objects per domain namespace (`{ "intake": { "verificationId": "..." }, "workflow": { "taskId": "..." } }`) rather than flat dot-notation keys (`"intake.verificationId"`). Flat dot-notation keys are unreachable via the JSON Logic `var` operator, which uses dots for path traversal — `{"var": "metadata.intake.verificationId"}` traverses into a nested object, but would fail on a flat key named `"intake.verificationId"`. This also maps naturally to the namespace-level mutation endpoints in Decision 12.

**Options:**
- **(A)** Domain-aware — typed FK fields (`verificationId`, `taskId`) on Document
- **(B)** ✓ Context pass-through — `metadata` is an opaque JSON object structured as nested objects per domain namespace; document management stores and echoes the current state of `metadata` in events without interpreting it. See [Decision 12](#decision-12-metadata-mutability-and-update-model) for how namespaces are managed after creation.

---

### Decision 3: Document-subject association model

**Status:** Decided: B

**What's being decided:** How to track which program records a document belongs to — applications, cases, appeals, or others — so the same document can serve multiple programs and its retention period doesn't start until all of them are closed.

**Considerations:**
- FNS policy supports reuse of documents across programs in a single application and across a household's applications over time. A model where each document belongs to exactly one application cannot support reuse without duplication — which creates retention management problems (which copy starts the clock?) and unnecessary storage cost.
- IBM FileNet IER, Laserfiche, and Hyland OnBase all support linking a document to multiple case objects — through case folders, shortcut references, or link tables respectively. All major government ECM platforms converge on a junction or link model for this reason.
- `DocumentLink.closedAt` is the trigger for closure-based retention types: when a subject closes, the system sets `closedAt` on all associated links. For documents linked to multiple subjects, each link has its own `closedAt`. For `case_closure` and `application_denial` triggers, retention starts from the latest `closedAt` across all links — the clock doesn't start until all associated subjects are closed.

**Options:**
- **(A)** Direct FK on Document — `document.applicationId` or `document.caseId`; one subject per document
- **(B)** ✓ `DocumentLink` junction entity with `closedAt` — many-to-many with per-link retention tracking

---

### Decision 4: DocumentType as config-managed resource

**Status:** Decided: C

**What's being decided:** How to manage document types so states can add program-specific types and configure per-type retention schedules without contract changes, while providing a consistent baseline.

**Considerations:**
- Baseline types (pay stub, bank statement, birth certificate, lease agreement, utility bill) are common across states and programs. Seeding them via configuration provides a consistent starting point.
- States need to add program-specific types (tribal enrollment documents, state-specific income verification forms, etc.) without requiring a contract change.
- The blueprint's `config_managed_resources` pattern (defined in `api-patterns.yaml`) uses a `source` field (`system` vs. `user`) to distinguish seeded from runtime-created entities and gates deletion accordingly. This pattern is already established for other config-managed resources.
- Per-type retention configuration follows the Laserfiche and Hyland OnBase model — each record type carries its own retention schedule rather than relying on a global default.

**Options:**
- **(A)** Hardcoded enum — document types are a fixed contract enum
- **(B)** Runtime-only — all types created via API, none seeded
- **(C)** ✓ Config-managed — baseline types seeded via `document-management-config.yaml`; states add more at runtime; `source` field distinguishes them; per-type `retentionYears` and `retentionTrigger`

**Customization:** See [Customization — Document types](#document-types) for how states configure baseline types and add program-specific ones.

---

### Decision 5: Legal hold modeling

**Status:** Decided: B

**What's being decided:** How legal hold — when a document must be frozen and not destroyed — fits into the normal lifecycle without adding a separate set of states just for held documents.

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

**What's being decided:** Whether to expose a dedicated endpoint for file content — separate from the version metadata endpoint — and if so, whether it streams the file to the requester or redirects them to fetch it from storage. The two questions are linked: the dedicated endpoint is what makes the audit record unambiguous.

**Background:** There are exactly two HTTP mechanisms for serving file bytes from a storage backend: the API server fetches the file and streams it in the response body (`200`), or the API server issues a redirect and the client fetches directly from storage (`302`). These are the only two options. The decision is which to support and which to make the default.

**Considerations:**
- A dedicated content endpoint — separate from `GET /document-versions/{documentVersionId}` which returns JSON metadata — provides a single, unambiguous API call to log as "this file was accessed." HIPAA (45 CFR § 164.312) requires an audit record of who accessed which file and when. The alternative, a `downloadUrl` field on the version resource, loses this if the URL points directly to storage: the actual download happens outside the API and goes unobserved. Box, SharePoint, and Dropbox all use dedicated content endpoints for the same reason.
- Proxied delivery (API streams bytes): full auth enforcement on every request, storage backend not exposed to clients, download auditable at API layer. Higher server load and latency.
- Redirect delivery (302 to a time-limited storage URL): direct client-to-storage download, lower API server load. Exposes storage bucket name and cloud provider to clients. The URL can be forwarded and used within its expiry window (typically 5–15 minutes) without re-authenticating to the API.
- Box implements direct download via signed URL, logging URL issuance as the audit event. SharePoint and OnBase support both modes. Government deployments typically default to proxied for security posture.
- The audit event fires when `GET /document-versions/{documentVersionId}/content` is called regardless of response type — the authorization event is captured at API layer in both modes.
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
- **(C)** ✓ Contract-neutral — both `200` (binary stream) and `302` (redirect) documented as valid responses on `GET /document-versions/{documentVersionId}/content`; proxy is the default; states switch to redirect by adding `x-content-delivery: redirect` to the content operation via overlay

**Decision:** Baseline implements option C. See [Customization — File retrieval delivery mode](#file-retrieval-delivery-mode) for how states switch to redirect delivery.

---

### Decision 7: Duplicate detection

**Status:** Decided: B

**What's being decided:** Whether to detect when the same file is uploaded more than once, and what to do about it, given that re-uploads are common and often intentional but some states may want to flag or block them.

**Considerations:**
- M-Files and OpenText surface duplicate content warnings at upload time; neither enforces uniqueness by default — enforcement is configurable per document type.
- In safety net programs, re-uploading the same file is common and often legitimate (caseworker retry, same pay stub for a different program). Any enforcement behavior should be state-configured, not a baseline default.
- Storing a SHA-256 hash on every version enables detection at no cost to the upload path and makes the capability available to states without a contract change.

**Options:**
- **(A)** No detection — no hash stored; duplicate uploads not addressed
- **(B)** ✓ Passive detection — `contentHash` stored on every `DocumentVersion`; baseline enforces nothing; states add warning or rejection behavior via customization
- **(C)** Non-blocking warning — upload always succeeds; if a matching hash exists, `201` response includes `duplicateVersionId`
- **(D)** Opt-in rejection — `?rejectDuplicates=true` on upload; `409 Conflict` if hash matches an existing version

**Customization:** See [Customization — Duplicate detection](#duplicate-detection) for how states can implement options C or D.

---

### Decision 8: Virus scanning model

**Status:** Decided: B

**What's being decided:** How virus scanning fits into the upload flow — whether a flagged file stops the upload immediately or is quarantined and reviewed afterward — given that the two approaches work very differently for users and for whoever builds the system.

**Considerations:**
- For safety net documents (small files submitted directly by applicants and caseworkers), synchronous blocking gives immediate feedback: the upload request is short-lived enough to hold open during a scan, and the uploader knows right away to try a different file.
- Async quarantine — upload succeeds but content is inaccessible until a background scan completes — is better suited for large-file or batch pipelines where holding the HTTP connection open during scanning is not feasible. Some enterprise ECM platforms support this model for those use cases.
- Both models require a contract surface: synchronous adds a 422 error response to the upload endpoint; async adds a `scanStatus` field on `DocumentVersion` and a quarantine event.

**Options:**
- **(A)** No contract surface — scanning is purely an adapter infrastructure concern
- **(B)** ✓ Synchronous blocking — upload returns `422 Unprocessable Entity` with error code `file_rejected_by_virus_scan` if the adapter's scanner rejects the file; no `DocumentVersion` is created
- **(C)** Async quarantine — upload succeeds; `DocumentVersion` gets a `scanStatus` field (`pending`, `clean`, `quarantined`); a background scan updates the status; file content is inaccessible while quarantined

**Customization:** See [Customization — Virus scanning — async quarantine](#virus-scanning--async-quarantine) for how states can implement option C.

---

### Decision 9: Document creation model

**Status:** Decided: B

**What's being decided:** Whether uploading a file and creating the document record happen in one step or two, which determines whether a document can exist without any content and how many calls it takes to create a usable document.

**Considerations:**
- Box, SharePoint, Salesforce ContentDocument/ContentVersion, and Laserfiche all require file content at creation — a document object cannot exist without its first version. Modern ECM platforms converge on atomic creation.
- The legacy enterprise ECM model (Documentum SysObject, IBM FileNet document class) allows creating a stub document without content — useful for pre-registering documents before content arrives in batch ingest pipelines. No equivalent use case exists in safety net programs, where documents are always submitted with their content.
- Atomic creation means `active` is always a state with at least one version; no pre-active state is needed and the lifecycle is simpler.

**Options:**
- **(A)** Separate operations — `POST /documents` creates a document record without content; a second call uploads the first version; an intermediate pre-active state is required
- **(B)** ✓ Atomic creation — `POST /documents` accepts both file bytes and document metadata; creates `Document` and first `DocumentVersion` in one operation; document is `active` immediately

---

### Decision 10: Retention trigger evaluation model

**Status:** Decided: B

**What's being decided:** How to store and apply the rules for when a document's retention period starts, so states can set different rules per document type without changing the core system logic.

**Considerations:**
- Laserfiche and Hyland OnBase implement "cutoff instructions" as a configurable field on the record series — the records engine evaluates the cutoff type generically. DoD 5015.2 uses the same data-driven "disposition instruction" model; the standard explicitly anticipates that different record series have different cutoff criteria.
- Hard-coding each trigger type as a separate state machine transition means adding a new trigger type requires a state machine contract change and an overlay update for every state that wants it.
- The four baseline types (`case_closure`, `application_denial`, `document_date`, `submission_date`) cover the common patterns; states in specialized programs may need additional types (e.g., `program_year_close`, `benefit_end_date`).

**Options:**
- **(A)** State machine branches — each trigger type has its own transition guard; new types require state machine changes
- **(B)** ✓ Trigger as data — `DocumentType.retentionTrigger` evaluated by a single generic state machine guard; new trigger types added via overlay without modifying the state machine

---

### Decision 11: Destruction scope and metadata retention

**Status:** Decided: B

**What's being decided:** Whether a document's database record stays in `destroyed` state or is fully deleted when it is disposed of — which matters because federal regulations require a lasting, auditable record of what was destroyed and when. Physical deletion of file bytes from storage is handled by the storage layer and is not part of this decision.

**Considerations:**
- DoD 5015.2 requires a destruction certificate: evidence of what was destroyed, when, and under which schedule. Retaining records in `destroyed` state allows the API to return document and version metadata (type, title, uploader, timestamps) as an auditable record of what existed — more reliable than an event alone, which is lost if the consumer is unavailable or the log is purged.
- HIPAA (45 CFR § 164.312) requires chain-of-custody for PHI: records of who uploaded which version and when must survive the physical deletion of file content.
- Deleting the database record means `GET /documents/{documentId}` returns `404` — consumers cannot distinguish "never existed" from "was destroyed," which breaks downstream audit queries.
- All DoD 5015.2 compliant platforms (OpenText Documentum, IBM FileNet/IER) retain the document object in a terminal state after destruction.

**Options:**
- **(A)** Records deleted — `Document` and all `DocumentVersion` database records removed; `GET /documents/{documentId}` returns `404`; only the `document.destroyed` event serves as audit record
- **(B)** ✓ Records retained — `Document` remains in `destroyed` state; `DocumentVersion` records retained; `GET /documents/{documentId}` returns the document metadata with `lifecycleState: destroyed`; content endpoint returns an appropriate error; satisfies the DoD 5015.2 destruction certificate requirement alongside the `document.destroyed` event

**Decision:** The destruction certificate is the combination of the retained `Document` record (what was destroyed, under which schedule) and `dispositionApprovedBy` / `dispositionApprovedAt` fields stamped at destruction time (who authorized it and when) — meeting the DoD 5015.2 requirement for documented evidence of what was destroyed and by whose authority.

---

### Decision 12: Metadata mutability and update model

**Status:** Decided: B

**What's being decided:** Whether the `metadata` correlation context on a Document can be updated after the document is created, and if so, how to structure updates so multiple callers can each manage their own keys without overwriting each other.

**Considerations:**
- Box, Google Drive, SharePoint, Salesforce, and IBM FileNet all make document metadata mutable after creation. Write-once is not an industry pattern.
- Multiple systems may attach correlation context to the same document at different points — intake at upload time, a signing service when an e-signature workflow completes, workflow when it assigns a review task. All need to store their own context without knowing what other callers have set.
- A PATCH that replaces the entire `metadata` JSON object risks overwriting another caller's namespace. Merge semantics prevent this but cannot be enforced by the contract — they are a server convention a client can violate.
- Because `metadata` is structured as nested objects per domain namespace (see Decision 2), the natural mutation unit is the namespace sub-object, not the individual key. Namespace-level endpoints (`PUT /documents/{documentId}/metadata/{domain}` and `DELETE /documents/{documentId}/metadata/{domain}`) replace or remove one caller's entire sub-object atomically. No operation touches another caller's namespace, so the contract makes cross-caller overwrite structurally impossible.
- Using the domain name as the path parameter avoids URL encoding issues that arise with slash-separated or dot-notation flat keys. `{domain}` is an enum from the shared `Domain` component in `components/common.yaml`, providing a fixed set of valid namespace names. Box uses a similar `templateKey` path parameter for the same purpose.

**Options:**
- **(A)** Write-once at creation — `metadata` is set on POST and cannot be updated; prevents overwrite but rules out post-upload correlation context
- **(B)** ✓ Mutable via namespace-level endpoints — `PUT /documents/{documentId}/metadata/{domain}` replaces the caller's entire namespace sub-object; `DELETE /documents/{documentId}/metadata/{domain}` removes it; `{domain}` is an enum from the shared `Domain` component; `metadata` is not included in the Document PATCH schema
- **(C)** Mutable via merge PATCH — PATCH body is a partial JSON object; server merges at key level; overwrite prevention depends on server implementation, not contract structure

**Customization:** States that need per-key access controls within a namespace can add those constraints via overlay on the metadata endpoints.

---

## Customization

### Baseline constraints

Elements with external compliance or structural dependencies:

| Element | Reason | Decision |
|---|---|---|
| Two-level `Document` + `DocumentVersion` structure | Removing it requires redesigning versioning and cross-program reuse | [Decision 1](#decision-1-two-level-document-model) |
| `Document.lifecycleState` | The records management lifecycle itself; removing it collapses the retention and disposition system | [Decision 5](#decision-5-legal-hold-modeling) |
| `Document.legalHold` | DoD 5015.2 requires a hold flag; renaming is acceptable | [Decision 5](#decision-5-legal-hold-modeling) |
| `Document.documentTypeId` | Anchor for per-type retention rules; without it the retention system has no basis for computing deadlines | [Decision 10](#decision-10-retention-trigger-evaluation-model) |
| `Document.retentionDeadline` | Stores the computed deadline so the system can automatically advance the document to `pending_disposition`; removing it requires an alternative mechanism | [Decision 10](#decision-10-retention-trigger-evaluation-model) |
| `Document.dispositionApprovedBy` / `dispositionApprovedAt` | Required by DoD 5015.2 for the destruction certificate — who authorized destruction and when | [Decision 11](#decision-11-destruction-scope-and-metadata-retention) |
| `DocumentVersion.uploadedById` | Required by HIPAA (45 CFR § 164.312) for chain-of-custody — who uploaded each version | — |
| `DocumentVersion.createdAt` | Authoritative upload timestamp; the domain cannot rely on storage backend metadata for this | — |
| `DocumentLink.closedAt` | The trigger event timestamp for closure-based retention; removing it breaks `case_closure` and `application_denial` retention triggers | [Decision 3](#decision-3-document-subject-association-model) |
| `DocumentLink.linkedBy` | Required by HIPAA (45 CFR § 164.312) for chain-of-custody — who created each document-subject association | — |

### Document types

See [Decision 4](#decision-4-documenttype-as-config-managed-resource) for why document types are config-managed rather than hardcoded. States configure baseline document types in a `document-management-config.yaml` deployment artifact. Each type specifies `retentionYears` and `retentionTrigger`. States with longer retention requirements (e.g., Medicaid estate recovery) set an appropriate `retentionYears` value or use `document_date` as the trigger for documents without a clear closure event. States can also create additional document types at runtime via the API; runtime-created types are marked `source: user` and can be deleted, unlike config-seeded types.

### Entity fields

States can add fields to Document, DocumentVersion, DocumentType, and DocumentLink via overlay.

### File retrieval delivery mode

The content endpoint defaults to proxy delivery (`200` with streamed bytes). States switch to redirect delivery (`302` to a signed storage URL) by adding an overlay that sets `x-content-delivery: redirect` on the `GET /document-versions/{documentVersionId}/content` operation. Both response shapes are already documented in the OpenAPI spec, so clients handle either without contract changes. See [Decision 6](#decision-6-file-retrieval-model) for the full trade-off analysis.

### State machine

States can extend the document lifecycle via overlay — adding custom states, transitions, or guards.

### Version restore

States that need explicit restore semantics can add a `POST /documents/{documentId}/restore-version` endpoint. One approach: create a new `DocumentVersion` copying the target version's file content, update `Document.latestVersionId`, and emit a version-uploaded event. A `restoredFromVersionId` field on `DocumentVersion` can optionally preserve the audit trail context.

### Virus scanning — async quarantine

See [Decision 8](#decision-8-virus-scanning-model) for why the baseline chose synchronous blocking. States that prefer async scanning (e.g., for large files or batch pipelines) could add a `scanStatus` field to `DocumentVersion` (`pending`, `clean`, `quarantined`) and make file content inaccessible while `scanStatus` is `pending` or `quarantined`. A background scan updates the status; if quarantined, a `document_version.quarantined` event fires so consumers (caseworkers, intake) know not to act on the version. Once cleared, the version becomes accessible normally.

### E-signature

States integrating a signing service (DocuSign, Adobe Sign, etc.) store the completed signed document as a new `DocumentVersion` upload. Two approaches for carrying signature metadata:

- **Pass-through** — the signing integration writes its correlation context (envelope ID, signed-at timestamp, signer identity) into `Document.metadata` under its own namespace via `PUT /documents/{documentId}/metadata/{domain}` after the signed document is uploaded. The domain stores and echoes this without interpreting it.
- **Typed fields** — states that want signature state to be queryable within the domain can add fields to `DocumentVersion` via overlay — for example `signatureStatus` (`unsigned`, `pending`, `signed`, `rejected`), `signedAt`, and `signedById`.

### Chunked upload

States that need resumable or chunked upload support can add a parallel upload session flow alongside the standard single-POST endpoint. One approach: a `POST /upload-sessions` endpoint initiates the session and returns a session ID; clients post chunks to `/upload-sessions/{uploadSessionId}/chunks`; a finalization call assembles the chunks and creates a `DocumentVersion` via the normal path. The TUS open protocol (tus.io) provides a well-established contract for this pattern if states want interoperable client support.

### Duplicate detection

`contentHash` is stored on every version but the baseline enforces nothing. See [Decision 7](#decision-7-duplicate-detection) for why the baseline chose passive detection. States can build on it in two ways:

- **Non-blocking warning** — if the incoming hash matches an existing version on the same document, the upload could succeed with `201` and include a `duplicateVersionId` in the response, allowing callers to decide what to do without blocking the upload.
- **Opt-in rejection** — a `?rejectDuplicates=true` query parameter could return `409 Conflict` with the matching `duplicateVersionId` when a hash collision is found, for workflows where strict uniqueness is needed.

## Out of scope

Adjacent concerns a reader might assume this domain owns, but that are not document management capabilities:

| Capability | Domain | Notes |
|---|---|---|
| Verification sufficiency decisions | Intake | Whether a document satisfies a verification obligation is an intake rules concern |
| Eligibility determination | Eligibility | Document content does not feed directly into eligibility logic |
| Caseworker review workflow | Workflow | Creating and routing review tasks in response to document uploads |
| Case file assembly | Case management | Organizing documents into a case record view |

## Capability coverage

### Document creation and versioning

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Document creation with metadata | All major platforms | **Planned** |
| Version history (immutable per upload) | All major platforms | **Planned** |
| Version restore | Enterprise ECM (Documentum, FileNet) | **Not in scope** — core use case covered by uploading a new version; see [Customization — Version restore](#version-restore) for adding explicit restore semantics |
| Bulk document import | Enterprise ECM (FileNet, OnBase, OpenText) for ongoing scanning workflows | **Planned** — see #260 |
| Concurrent edit locking | Documentum, FileNet, OnBase | **Not in scope** — documents are immutable per upload; no in-place editing model |
| Metadata namespace management (add/remove after creation) | Box (Metadata API), Google Drive (file properties) | **Planned** — namespace-level PUT/DELETE endpoints; see [Decision 12](#decision-12-metadata-mutability-and-update-model) |

### Cross-program reuse

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Document sharing across subjects | Laserfiche, FileNet IER, OnBase | **Planned** — DocumentLink model |
| Duplicate detection | M-Files, OpenText | **Planned** — `contentHash` on DocumentVersion. See [Decision 7](#decision-7-duplicate-detection) and [Customization — Duplicate detection](#duplicate-detection). |

### Records management

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Per-type retention scheduling | OnBase, Laserfiche, OpenText | **Planned** — DocumentType.retentionYears / retentionTrigger |
| Legal hold | All DoD 5015.2 platforms | **Planned** — legalHold boolean |
| Disposition approval (per document) | DoD 5015.2 requirement | **Planned** — `POST /documents/{documentId}/approve-disposition` RPC endpoint |
| Bulk disposition approval | Laserfiche, OnBase batch review | **Planned** — see #260 |
| Destruction audit | DoD 5015.2 requirement | **Planned** — via events |

### Access and audit

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Document access audit trail | HIPAA, DoD 5015.2 | **Planned** — event on content request |
| Role-based access control | All major platforms | **Not in scope** — identity-access domain |
| Document-level ACLs | Enterprise ECM | **Planned** — see #261; depends on identity-access principal model |

### File delivery

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Proxied download (secure default) | Government deployments | **Planned** |
| Redirect to signed URL (performance opt-in) | Box, S3-backed ECM | **Planned** — opt-in via overlay; see [Customization — File retrieval delivery mode](#file-retrieval-delivery-mode) |
| Chunked / resumable upload | S3 multipart, Azure Blob | **Adapter layer** — storage-specific protocol; the upload endpoint contract stays as a single POST; see [Customization — Chunked upload](#chunked-upload) |
| Virus scanning / malware detection | Enterprise ECM upload pipelines | **Adapter layer** — scanning is performed by the adapter; the contract defines the error surface (`422 file_rejected_by_virus_scan`) for when the adapter rejects a file; see [Decision 8](#decision-8-virus-scanning-model) and [Customization — Virus scanning](#virus-scanning--async-quarantine) for async quarantine |
| E-signature | DocuSign, Adobe Sign integrations in ECM | **Adapter layer** — no signing integration in baseline; the completed signed document is stored as a normal version upload; see [Customization — E-signature](#e-signature) |

### Integration

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Event emission on upload | Box, SharePoint/Graph, modern ECM | **Planned** — document_version.uploaded event |
| Event emission on document creation | Modern ECM | **Planned** — document.created event |
| OCR / content extraction | OpenText, FileNet, OnBase | **Adapter layer** — text extraction on upload is a storage adapter concern; extracted content feeds the search domain |
| Full-text search | OpenText, FileNet, OnBase | **Not in scope** — search domain |

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
