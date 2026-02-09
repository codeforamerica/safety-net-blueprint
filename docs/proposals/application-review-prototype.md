# Proposal: Application Review Prototype

**Status:** Draft

**Sections:**

1. **[Application Review](#application-review)** — The use case, what the system does, walkthrough
2. **[Prototype Scope](#prototype-scope)** — What's covered, what's deferred
3. **[OpenAPI Schemas](#openapi-schemas)** — Application, ApplicationMember, Income, SectionReview
4. **[Form Definition](#form-definition)** — Program requirements, section definitions, field definitions with annotations, annotation extensibility

---

## Application Review

A caseworker opens a multi-program eligibility application — say, someone applying for both SNAP and Medicaid. Different programs require different review sections: Medicaid needs a tax filing review (for MAGI determination), SNAP doesn't. Within shared sections like Income, the same field means different things: the amount field is "gross income" for SNAP but "net income for MAGI" for Medicaid. Typically, these differences are hardcoded in frontend logic — adding a program means changing code in every place that checks which program it is.

The risk: multi-program form logic gets embedded in frontend code — which programs require which sections, how fields differ by program, what verification is needed, which regulations apply. Every new program or policy change requires code changes across the frontend, and there's no single place to see what a program requires or how a field is used. A form definition contract addresses this by centralizing form structure, field annotations, and program requirements as configuration. It also enables reuse — the same form definition can drive different applications (caseworker review, applicant-facing intake, supervisor dashboards) without duplicating the logic that determines what to show.

This prototype demonstrates a different approach: the system reads a **form definition** — a configuration artifact that declares which sections each program requires, when sections are visible, and how each field is relevant to each program. The frontend renders from the form definition without knowing anything about specific programs. Adding a program is a table change, not a code change.

### What the system does

| Capability | Example |
|-----------|---------|
| **Determines review scope from configuration** | A SNAP + Medicaid application gets Identity, Income, and Tax Filing reviews. A SNAP-only application gets Identity and Income — no Tax Filing. Which sections each program requires is defined in a table. The system creates review records from this table on submission — the backend reads the form definition, not just the frontend. |
| **Shows program-specific field context** | A caseworker reviewing Income sees "gross amount counted" for SNAP and "net amount for MAGI" for Medicaid next to the amount field. The same field means different things to different programs — program relevance annotations capture this without hardcoding. |
| **Provides verification guidance** | Citizenship status shows "self-attestation accepted" for citizens and "immigration document required" for non-citizens. Income amount requires "pay stub, employer letter, or tax return." Verification requirements are annotations — the frontend renders them the same way it renders program relevance. |
| **Links fields to regulatory basis** | Citizenship status traces to 7 CFR 273.4 (SNAP) and 42 CFR 435.406 (Medicaid). When a regulation changes, every affected field is discoverable from the form definition. Regulatory citations are another annotation type — no special handling needed. |

### What the caseworker sees

A review dashboard with:
- **Application summary** — member list with programs applied for
- **Section review list per member** — sections determined by the form definition's program requirements
- **Section detail with field annotations** — field values with program relevance, verification guidance, and regulatory citations from the form definition

### Walkthrough

**Setup:**
1. Conversion scripts generate form definition YAML from the tables in this document
2. Validation script confirms internal consistency — section IDs match between program requirements and section definitions, field source paths resolve to OpenAPI schema fields
3. Mock server loads the generated YAML and seed data

**1. Build the application** — `POST /intake/applications` with `programs: { snap: true, medicalAssistance: true }`. Then add one member applying for SNAP + Medicaid, with income records.

*What happens:*
- Application created in `draft` status. Member and income records created via CRUD. No review records yet.

**2. Submit the application** — `POST /intake/applications/:id/submit`

*What happens:*
- Application transitions from `draft` to `submitted`.
- On submission, the system iterates over the application's members. For each member, the program requirements table is evaluated — SNAP requires identity + income, Medicaid requires identity + income + tax filing. Union: 3 sections.
- 3 SectionReview records created. Tax Filing exists because the member has Medicaid.

**3. Load the review dashboard** — frontend fetches the application, its members, the form definition, and SectionReview records.

*What happens:*
- Dashboard shows the application summary and member list. Caseworker selects a member.
- Frontend fetches SectionReview records for that member — 3 work items (identity, income, tax_filing). Each links to a section in the form definition via `sectionId`.
- The frontend evaluates `visibleWhen` on Tax Filing — it's true (member has Medicaid). If the member were SNAP-only, Tax Filing wouldn't appear — no SectionReview would exist and the frontend's `visibleWhen` check would also be false.

**4. Open the Income section review** — caseworker clicks the Income SectionReview. Frontend reads `sectionId: income`, looks up the income section in the form definition, fetches member data and income records via `memberId`.

*What happens:*
- Caseworker sees each income record with annotations: amount field shows program relevance ("gross amount counted" for SNAP, "net amount for MAGI" for Medicaid), verification requirement ("pay stub, employer letter, or tax return"), and regulatory citation (7 CFR 273.9(a) for SNAP).
- Annotations come from the form definition, not hardcoded frontend logic. The frontend followed the navigation chain: SectionReview → sectionId → form definition section → field definitions + annotations.

---

## Prototype Scope

This document follows the **steel thread** approach — the thinnest end-to-end slice needed to prove a specific part of the [contract-driven architecture](contract-driven-architecture.md). This prototype proves the **form definition artifact**: configuration-driven forms that adapt to programs, applicants, and field context. The [workflow prototype](workflow-prototype.md) proves the behavioral contract artifacts (state machine, rules, metrics) at depth. Between the two, every artifact type is covered. They can be done in either order.

> **Authoring note:** The tables in this document are the authoring format. Conversion scripts read them and generate the form definition YAML — a build artifact that nobody edits by hand. See [Authoring Experience](contract-driven-architecture.md#authoring-experience) for the full workflow.

### Architecture concepts exercised

| Concept | Exercised by |
|---------|-------------|
| Form definition tables → YAML conversion | Conversion scripts generate valid form definition YAML from program requirements, section definitions, field definitions, and regulatory citations tables |
| Source path validation | Validation script verifies `income.type` resolves to Income schema, `member.taxFilingInfo.willFileTaxes` resolves to ApplicationMember schema |
| Form definition drives record creation | Application submission creates SectionReview records from the program requirements table |
| Expression evaluation | `visibleWhen` conditions use the same format as rule conditions (e.g., JSON Logic) |
| Annotation extensibility | Three annotation types (program relevance, verification, regulatory citations) — the frontend renders all of them without type-specific logic |
| Object APIs | Application, ApplicationMember, Income, SectionReview — standard CRUD from OpenAPI spec |
| Action API | `submit` → `POST /intake/applications/:id/submit` |

### What's not in the prototype

- **SectionReview lifecycle** — start_review, approve, request_correction, resubmit. These follow the same state machine, guard, effect, and audit patterns proven by the [workflow prototype](workflow-prototype.md). The workflow prototype could pick up SectionReview as a second state machine to prove multi-domain workflow.
- **Routing rules** — assignment and priority rules for SectionReview queue routing. Same decision table patterns as the workflow prototype.
- **Metrics** — review_time_per_section, sections_pending_review, correction_rate. Same metric source types as the workflow prototype.
- **Audit trail** — ReviewAuditEvent on all transitions. Same pattern as the workflow prototype.
- **Additional sections** — Assets, Expenses, Employment History, Medical Expenses, Shelter Costs. More rows in the same tables.
- **Additional programs** — TANF, WIC, CHIP. More columns in the program requirements table.
- **Applicant-facing forms** — this covers caseworker review forms only.
- **Document uploads** — supporting documents attached to sections.
- **Eligibility determination** — would use the `call` effect type from the [contract-driven architecture](contract-driven-architecture.md#complex-calculation-logic).
- **Conditional section requirements** — program requirements cells that have conditions instead of flat Required/—. For example, "Assets required for Medicaid when non-MAGI eligibility group" or "Tax Filing required only for adults (not children)." The server would evaluate the condition during record creation using the same expression engine (JSON Logic) already proven by `visibleWhen` on the client side. Would add a condition column to the program requirements table.
- **Notifications** — effects that notify caseworkers on corrections or completion.

---

## OpenAPI Schemas

The adapter exposes standard CRUD endpoints for each schema (`GET /intake/applications`, `GET /intake/application-members`, `GET /intake/incomes`, etc.) and a form definition endpoint (`GET /intake/form-definition`) that serves the form definition YAML as JSON. SectionReview records live in the workflow domain (`GET /workflow/section-reviews`). The OpenAPI schemas are referenced by the form definition's field source paths — the validation script verifies the paths resolve.

> **Schema note:** The schemas below are simplified for readability. The [current Intake schemas](../../packages/schemas/openapi/components/application.yaml) use a nested document structure (members and income are nested inside Application). That structure is being revisited — the direction is toward flatter, separately addressable resources like the ones shown here. Where types differ, the values below match the current schemas. The form definition pattern works with either structure — only the field source paths change.

### Application

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Unique identifier |
| status | enum | `draft`, `submitted` |
| programs | object | Programs applied for — `snap` (boolean), `cashPrograms.tanfProgram` (boolean), `cashPrograms.adultFinancial` (boolean), `medicalAssistance` (boolean) |
| submittedAt | datetime | When the application was submitted |
| createdAt | datetime | Creation timestamp |
| updatedAt | datetime | Last update timestamp |

### ApplicationMember

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Unique identifier |
| applicationId | uuid | Reference to Application |
| firstName | string | First name |
| lastName | string | Last name |
| relationship | enum | `self`, `spouse`, `child`, `parent`, `sibling`, `other_relative`, `non_relative` |
| programsApplyingFor | enum[] | Programs this member is applying for (subset of application's programs) |
| citizenshipInfo | object | Nested — `status` (enum: `citizen`, `permanent_resident`, `qualified_non_citizen`, `undocumented`, `other`), `immigrationInfo.documentType` (string), `immigrationInfo.documentNumber` (string) |
| taxFilingInfo | object | Nested — `willFileTaxes` (boolean), `filingJointlyWithSpouse` (boolean), `expectsToBeClaimedAsDependent` (boolean), `willClaimDependents` (boolean) |

### Income

Separate API resource — 0 to N per member. Each record represents one income source.

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Unique identifier |
| personId | uuid | Reference to ApplicationMember |
| type | enum | `employed`, `self_employed`, `unearned` |
| unearnedType | enum | Subcategory when type is `unearned` — `unemployment`, `ssi_or_ssdi`, `child_support`, `social_security_retirement`, etc. |
| employer | string | Employer name (when type is `employed`) |
| amount | number | Income amount |
| frequency | enum | `hourly`, `daily`, `weekly`, `every_2_weeks`, `twice_a_month`, `monthly`, `yearly` |
| createdAt | datetime | Creation timestamp |
| updatedAt | datetime | Last update timestamp |

### SectionReview

The work item — tracks the review of a single section for a single member. Auto-created when an application is submitted (the form definition's program requirements table determines which records to create). SectionReview is what appears in the caseworker's queue and what the frontend uses to navigate to the right form definition section.

**Navigation chain:** Caseworker clicks a SectionReview in their queue → frontend reads `sectionId` → looks up the matching section in the form definition → fetches member data via `memberId` → renders the section with field annotations.

| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Unique identifier |
| applicationId | uuid | Reference to Application |
| memberId | uuid | Reference to ApplicationMember |
| sectionId | string | Links to a section in the form definition (e.g., `identity`, `income`, `tax_filing`) — this is how the frontend knows what to render |
| status | enum | `pending` (initial state — lifecycle transitions deferred to the [workflow prototype](workflow-prototype.md)) |
| assignedToId | uuid | Caseworker assigned to this review (deferred — set by workflow routing rules) |
| createdAt | datetime | Creation timestamp |
| updatedAt | datetime | Last update timestamp |

---

## Form Definition

This is the primary section — the new artifact type being proven. The form definition describes what sections and fields to display, which programs require which sections, and how fields are relevant to each program. The frontend renders from this definition without hardcoding domain-specific rendering logic — the same mechanism works for any context that drives rendering differences (programs, roles, eligibility groups, application state). This prototype proves it with programs.

The form definition YAML is generated from the tables below. The conversion script reads the program requirements, section definitions, field definitions, and regulatory citations tables and produces a single form definition YAML file. The validation script verifies that field `source` paths resolve to fields in the OpenAPI schemas and that section IDs referenced in program requirements match defined sections.

### Program Requirements

Which sections each program requires. When an application is submitted, the system iterates over the application's members. For each member, sections marked "Required" for any of that member's programs get SectionReview records created. The logic unions the requirements across all programs the member is applying for.

| Section | Scope | SNAP | Medicaid |
|---------|-------|------|----------|
| identity | per-member | Required | Required |
| income | per-member | Required | Required |
| tax_filing | per-member | — | Required |

3 sections × 2 programs. Identity is universal. Income is universal but with program-specific field relevance (see field definitions below). Tax Filing is Medicaid-only (for MAGI determination) — a member applying only for SNAP won't have a tax filing section review.

### Section Definitions

Sections with visibility conditions. The `visibleWhen` condition determines whether the section appears in the review UI for a given member — it's evaluated client-side against the member's data.

| Section ID | Label | Scope | visibleWhen |
|------------|-------|-------|-------------|
| identity | Identity | per-member | *(always visible)* |
| income | Income | per-member | *(always visible)* |
| tax_filing | Tax Filing | per-member | `member.programsApplyingFor contains "medicalAssistance"` |

Tax Filing is only visible when the member is applying for Medicaid. A member applying only for SNAP sees Identity and Income but not Tax Filing. This condition is expressed in the same format as rule conditions (e.g., JSON Logic) — the frontend evaluates it against the member object to determine visibility.

### Field Definitions

Fields within a section, with source paths linking to OpenAPI schemas, program relevance annotations, and verification requirements. Each section has its own field definitions table.

**How fields link to OpenAPI schemas:** The `source` column uses dot-notation paths linking to OpenAPI schema fields — see [Source paths](contract-driven-architecture.md#form-definitions) for the full mechanism. For example, `member.citizenshipInfo.status` references the ApplicationMember schema's nested citizenshipInfo.status field.

**Identity section:**

| Field | Source | Type | Program Relevance | Verification |
|-------|--------|------|-------------------|--------------|
| firstName | member.firstName | string | SNAP, Medicaid | self-attestation |
| lastName | member.lastName | string | SNAP, Medicaid | self-attestation |
| relationship | member.relationship | enum | SNAP: who purchases and prepares food together; Medicaid: affects MAGI household size | self-attestation |
| citizenshipStatus | member.citizenshipInfo.status | enum | SNAP: must be citizen or qualified non-citizen; Medicaid: affects eligibility category | citizen: self-attestation; non-citizen: immigration document |

**Income section:**

| Field | Source | Type | Program Relevance | Verification |
|-------|--------|------|-------------------|--------------|
| type | income.type | enum | SNAP: all types counted toward gross income; Medicaid: varies by MAGI/non-MAGI eligibility group | self-attestation |
| employer | income.employer | string | SNAP: used for verification; Medicaid: used for verification | self-attestation |
| amount | income.amount | number | SNAP: gross amount counted; Medicaid: net amount for MAGI | pay stub, employer letter, or tax return |
| frequency | income.frequency | enum | SNAP: used to annualize; Medicaid: used to annualize | pay stub or employer letter |

**Tax Filing section:**

| Field | Source | Type | Program Relevance | Verification |
|-------|--------|------|-------------------|--------------|
| willFileTaxes | member.taxFilingInfo.willFileTaxes | boolean | Medicaid: determines MAGI vs non-MAGI eligibility pathway | self-attestation |
| filingJointlyWithSpouse | member.taxFilingInfo.filingJointlyWithSpouse | boolean | Medicaid: affects MAGI household composition | self-attestation |
| expectsToBeClaimedAsDependent | member.taxFilingInfo.expectsToBeClaimedAsDependent | boolean | Medicaid: determines whose tax household this person belongs to | self-attestation |
| willClaimDependents | member.taxFilingInfo.willClaimDependents | boolean | Medicaid: affects tax household size for MAGI | self-attestation |

The Income section has the richest annotation story — fields matter differently for SNAP vs. Medicaid, and verification requirements vary from self-attestation to document-based. Tax Filing fields are Medicaid-only (the section itself is only visible for Medicaid members). Identity fields are universal but with different program implications and a conditional verification requirement (citizenship status).

### Regulatory Citations

A third annotation type — linking fields to the regulations that require them. Unlike program relevance and verification (which are columns in the field definitions tables above), regulatory citations use a separate table to demonstrate the generalized annotations table pattern: each annotation is a row keyed by section, field, program, and type.

| Section | Field | Program | Regulation | Description |
|---------|-------|---------|------------|-------------|
| identity | citizenshipStatus | SNAP | 7 CFR 273.4 | Citizenship and alien status eligibility |
| identity | citizenshipStatus | Medicaid | 42 CFR 435.406 | Citizenship and immigration status requirements |
| income | amount | SNAP | 7 CFR 273.9(a) | Gross income determination |
| income | amount | Medicaid | 42 CFR 435.603(d) | MAGI-based income methodology |
| tax_filing | willFileTaxes | Medicaid | 42 CFR 435.603(b)–(d) | Tax filer vs non-filer household rules |

Not every field needs a citation — only those driven by program-specific regulations. When a regulation changes (e.g., an update to 7 CFR 273.9), every field it affects is discoverable from this table. The conversion script includes these citations in the generated YAML alongside program relevance and verification annotations.

**Program relevance**, **verification**, and **regulatory citations** are all annotation types — they tell the caseworker *how* a field matters, *what evidence* supports it, and *which regulation requires it*. Without them, the frontend would need hardcoded logic for each concern. With the form definition, the frontend reads annotations and renders them generically — it doesn't know what any annotation type means, it just displays them.

### Annotation extensibility

This prototype demonstrates three annotation types: **program relevance** and **verification** as columns in the field definitions tables, and **regulatory citations** as a separate table. The column format works for annotations that apply to most fields. The separate table works for sparse annotations that need additional structure. See [Extensibility and customization](contract-driven-architecture.md#extensibility-and-customization) for the generalized annotations table pattern and how annotation values can be structured.

**Future annotation types (not in this prototype):**
- **Role-based guidance** — different annotations for caseworkers vs. supervisors vs. applicants. The role becomes part of the context key.
- **Per-program field visibility** — `visibleWhen` conditions on individual fields, not just sections.
- **Editability** — which fields are read-only vs. editable for a given role or application state.
- **Conditional requirements** — fields required for some programs but optional for others.

