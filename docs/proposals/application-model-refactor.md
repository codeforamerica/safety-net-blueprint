# Proposal: Application Model Refactor

**Status:** Draft

**Sections:**

1. **[Personas](#1-personas)** — Applicant, caseworker, eligibility system
2. **[Design Decisions](#2-design-decisions)** — Single canonical model, domain sections, federal base vs state overlay
3. **[Domain Sections](#3-domain-sections)** — Logical groupings of eligibility data
4. **[API Resources vs Nested Objects](#4-api-resources-vs-nested-objects)** — What gets its own CRUD endpoints
5. **[Application Form Definition](#5-application-form-definition)** — Questionnaire as a behavioral contract
6. **[Review Tracking](#6-review-tracking)** — Per section per person
7. **[Program Requirements](#7-program-requirements)** — Which sections each program needs
8. **[Relationship to Existing Schemas](#8-relationship-to-existing-schemas)** — How this reshapes the current Application model

---

## 1. Personas

Three personas interact with the eligibility data at different stages:

**Applicant** — Fills out an integrated benefits application, selecting which programs to apply for (SNAP, Medicaid, TANF, etc.). Answers questions organized into sections. The questions presented depend on which programs are selected and on previous answers (conditional logic).

**Caseworker** — Reviews the submitted application. Reviews are organized by section per person — a caseworker reviews "income for Jane" once, even if Jane is applying for both SNAP and Medicaid. The caseworker should not have to review the same information twice across programs. However, different programs may count or use the same data differently (e.g., SNAP and Medicaid have different income counting rules), so the caseworker benefits from seeing which data points are relevant to which programs.

**Eligibility system** — Receives the application data for determination. Needs to know which data sections are required for each program so it can verify completeness before evaluating. Produces per-program determination results.

---

## 2. Design Decisions

### Single canonical model, not per-stage models

The underlying data is the same across all three personas. A person's income is the same whether the applicant reported it, the caseworker is reviewing it, or the eligibility system is evaluating it. What differs is the **workflow around the data** — entry, review, evaluation — not the data itself.

Separate models per stage (ApplicationSubmission, CaseworkerReview, EligibilityRequest) would duplicate every field across three schemas and require mapping logic between them. When a new field is added, three schemas need updating.

Instead: one canonical data model for the domain objects, with stage-specific concerns handled through separate mechanisms — the form definition governs what's collected, review tracking records what's been reviewed, and program requirements determine what's needed for determination.

### Organized by domain sections

Eligibility data is organized into logical sections that serve all three personas:

- The **applicant** fills out one section at a time
- The **caseworker** reviews and approves one section per person at a time
- The **eligibility system** checks that all required sections for the requested programs are complete

Sections are the unit of organization throughout the system — form definition, data model, review tracking, and program requirements all reference the same section identifiers.

### Federal base vs state customization

The base data model defines schemas at the federal level — fields required by federal program rules that apply in every state. States add state-specific fields, questions, and conditional logic via overlays.

**Federal base (this repository):**
- Schemas with fields required by federal program rules
- Base form definition with federally required questions
- Base program requirements mapping

**State customization (via overlay):**
- Additional fields within existing schemas (state-specific data points)
- Additional questions within existing sections
- Modified conditional logic (state-specific branching)
- Additional sections (state-specific program requirements)
- State-specific program variants

This follows the same overlay approach described in the [state customization proposal](state-customization.md).

---

## 3. Domain Sections

Each section groups related eligibility data. Sections marked **per member** are collected and reviewed for each household member individually. Sections marked **per household** apply to the household as a whole.

| # | Section | Scope | Description |
|---|---------|-------|-------------|
| 1 | **Identity** | per member | Name, date of birth, SSN, demographics, contact information |
| 2 | **Household Composition** | per household | Who lives together, relationships, who is applying for which programs |
| 3 | **Citizenship & Immigration** | per member | Citizenship status, immigration status and documents |
| 4 | **Income** | per member | Earned income (employment), self-employment, unearned income sources |
| 5 | **Expenses** | per member + per household | Dependent care, medical expenses, child support (per member); shelter costs, utilities (per household) |
| 6 | **Assets & Resources** | per member | Financial accounts, vehicles, real estate, insurance policies, transferred assets |
| 7 | **Health & Disability** | per member | Disability status, health insurance coverage, medical conditions, pregnancy |
| 8 | **Tax Filing** | per member | Filing status, dependents, MAGI-related deductions (Medicaid) |
| 9 | **Education & Training** | per member | School enrollment, student status, financial aid |
| 10 | **Housing** | per household | Address, rent/mortgage, housing assistance, utilities configuration |

States may add sections via overlay (e.g., a state-specific program with data requirements not covered by the federal sections).

---

## 4. API Resources vs Nested Objects

**Rule of thumb:** If the data is a collection with variable cardinality (0 to many items per person) and benefits from independent CRUD (add one item, delete one item without touching the parent), it should be an API resource. If it's a single bounded object (one per person, fixed structure), it stays nested within its parent.

### API resources (own CRUD endpoints)

| Resource | Scope | Why it's a resource | Example path |
|----------|-------|---------------------|-------------|
| **Application** | top-level | Container for the entire application | `GET/POST /applications` |
| **ApplicationMember** | per application | Links a person to an application with a per-member `programsApplyingFor` list | `GET/POST /applications/:appId/members` |
| **Income** | per member | 0-N records per person (multiple jobs, self-employment, unearned sources). Caseworker adds/removes individual records. | `GET/POST /applications/:appId/members/:memberId/income` |
| **Asset** | per member | 0-N records per person (bank accounts, vehicles, properties, insurance policies). Each is an independent item. | `GET/POST /applications/:appId/members/:memberId/assets` |
| **Expense** | per member or per household | 0-N records. Member-level (dependent care, medical, child support) and household-level (shelter, utilities). | `GET/POST /applications/:appId/expenses` |

Each ApplicationMember has their own `programsApplyingFor` list — Jane might apply for SNAP + Medicaid while her child applies for Medicaid only. This per-member selection drives which sections are required, which questions appear in the form, and which program relevance annotations are shown during review.

Expenses live at the application level (not nested under members) because some expenses are household-level with no associated member. Income and assets are always per-member, so they're nested under the member path. Expense records have an optional `memberId` field to indicate which member they belong to (null for household-level expenses), and can be filtered with `GET /applications/:appId/expenses?memberId=...`.

Each resource uses a `type` discriminator to distinguish specific kinds within the collection:

- **Income** `type`: `employment`, `self_employment`, `unearned` (with `unearnedType` for specific source)
- **Asset** `type`: `financial_account`, `vehicle`, `real_estate`, `insurance_policy`, `transferred_asset`
- **Expense** `type`: `dependent_care`, `medical`, `child_support`, `shelter`, `utility`, etc. (with optional `memberId` — null means household-level)

### Nested within ApplicationMember (one-to-one, bounded)

These are single objects per person with a fixed structure. They're always read and written alongside the member and don't benefit from independent CRUD.

| Nested object | Section | Why it's nested |
|--------------|---------|-----------------|
| `citizenshipInfo` | Citizenship & Immigration | One per person, fixed fields |
| `disabilityInfo` | Health & Disability | One per person, fixed fields |
| `healthCoverageInfo` | Health & Disability | One per person, summary of coverage |
| `educationInfo` | Education & Training | One per person, fixed fields |
| `taxFilingInfo` | Tax Filing | One per person, fixed fields |
| `familyPlanningInfo` | Health & Disability | One per person, fixed fields |

### Nested within Application (household-level, bounded)

| Nested object | Section | Why it's nested |
|--------------|---------|-----------------|
| `programs` | — | Derived from the union of all members' `programsApplyingFor` lists. Convenience field for high-level filtering (e.g., "does this application involve SNAP?") without iterating members. |
| `housingInfo` | Housing | One per application, fixed structure |

---

## 5. Application Form Definition

The application intake process is behavior-shaped. The questionnaire has conditional logic (show question X only if the answer to Y was Z), program-dependent sections (ask about tax filing only for Medicaid), and validation rules. This behavior should be captured in a portable contract — not hardcoded in a specific frontend.

### Recommendation: form definition YAML

A **form definition** is a contract artifact type alongside state machines, rules, and metrics. It defines:

- **Sections** — ordered groups of questions, mapped to domain sections
- **Questions** — individual data collection points, mapped to schema fields
- **Conditions** — JSON Logic expressions that control when questions and sections appear (consistent with how rules YAML uses JSON Logic)
- **Program requirements** — which sections and questions are required for which programs
- **Program relevance** — which questions and data types are relevant to which programs, enabling program-specific views of the same data
- **Validation** — required fields, value constraints, cross-field validation

```yaml
# forms/integrated-application.yaml
domain: intake
version: "1.0.0"
title: Integrated Benefits Application
defaultLocale: en

sections:
  - id: identity
    title: Personal Information
    scope: member
    requiredForPrograms: [snap, medicaid, tanf]
    questions:
      - id: name
        field: name
        label: What is your full legal name?
        type: name
        required: true

      - id: dateOfBirth
        field: dateOfBirth
        label: What is your date of birth?
        type: date
        required: true

      - id: ssn
        field: socialSecurityNumber
        label: What is your Social Security number?
        type: ssn
        required: true

  - id: citizenship
    title: Citizenship & Immigration
    scope: member
    requiredForPrograms: [snap, medicaid, tanf]
    questions:
      - id: citizenshipStatus
        field: citizenshipInfo.status
        label: What is your citizenship status?
        type: enum
        options: [us_citizen, us_national, permanent_resident, qualified_noncitizen, other_noncitizen]
        required: true

      - id: immigrationDocumentType
        field: citizenshipInfo.immigrationInfo.documentType
        label: What type of immigration document do you have?
        type: enum
        options: [permanent_resident_card, employment_authorization, refugee_travel_document, other]
        showWhen:
          "!=": [{ "var": "citizenshipInfo.status" }, "us_citizen"]

  - id: income
    title: Income
    scope: member
    requiredForPrograms: [snap, medicaid, tanf]
    description: Enter each income source as a separate record.
    resourceType: income    # This section manages an API resource, not nested fields
    programRelevance:       # How income types map to programs
      employment:
        relevantToPrograms: [snap, medicaid, tanf]
      self_employment:
        relevantToPrograms: [snap, medicaid, tanf]
      unearned:
        child_support:
          relevantToPrograms: [snap, tanf]
          notes:
            snap: Counted as unearned income
            tanf: Counted as unearned income
        social_security_benefits:
          relevantToPrograms: [snap, medicaid, tanf]
          notes:
            medicaid: Excluded from MAGI for most recipients
        unemployment_benefits:
          relevantToPrograms: [snap, medicaid, tanf]

  - id: tax_filing
    title: Tax Filing Information
    scope: member
    requiredForPrograms: [medicaid]
    questions:
      - id: willFileTaxes
        field: taxFilingInfo.willFileTaxes
        label: Will you file a federal tax return this year?
        type: boolean
        required: true

      - id: filingJointly
        field: taxFilingInfo.filingJointlyWithSpouse
        label: Will you file jointly with your spouse?
        type: boolean
        showWhen:
          "==": [{ "var": "taxFilingInfo.willFileTaxes" }, true]
```

### Program relevance annotations

The same data can be used differently by different programs. The form definition captures this through `relevantToPrograms` annotations at both the question level and the data type level.

**Question-level relevance** — for nested fields (1:1 objects), individual questions can be annotated with which programs care about that field:

```yaml
# Tax filing is only required for Medicaid, but within the section,
# some questions may also be relevant to other programs
- id: willFileTaxes
  field: taxFilingInfo.willFileTaxes
  label: Will you file a federal tax return this year?
  type: boolean
  required: true
  relevantToPrograms: [medicaid]

- id: expectsToBeClaimedAsDependent
  field: taxFilingInfo.expectsToBeClaimedAsDependent
  label: Does anyone claim you as a tax dependent?
  type: boolean
  relevantToPrograms: [medicaid, snap]   # SNAP uses this for household composition rules
```

**Data type relevance** — for collection resources (income, assets, expenses), the `programRelevance` block maps specific data types to programs with optional notes explaining how each program uses that data. This enables the UI to show program-specific views during review.

For example, when a caseworker reviews "Income for Jane," the UI can show:

```
Income for Jane                              Review: [Approved]
─────────────────────────────────────────────────────────────
  Employment - ABC Company      $2,100/mo    SNAP  Medicaid  TANF
  Child support                   $400/mo    SNAP  TANF
  Social Security                 $800/mo    SNAP  Medicaid* TANF
                                             * excluded from MAGI for most recipients
```

The data is entered and reviewed once. The program relevance annotations let the UI highlight which items feed into which program's determination — helping the caseworker understand the full picture without reviewing anything twice.

This pattern applies across sections:

| Section | Example of program-specific relevance |
|---------|--------------------------------------|
| **Income** | SNAP counts most income types; Medicaid MAGI excludes some (e.g., Social Security for most recipients); TANF has its own exemptions |
| **Assets** | SNAP tests countable resources (with elderly/disabled exemptions); Medicaid may or may not test assets depending on eligibility group; TANF has separate limits |
| **Expenses** | SNAP uses specific deduction categories (shelter, dependent care, medical for elderly/disabled); Medicaid MAGI doesn't use the same deductions |
| **Health & Disability** | Central to Medicaid eligibility grouping; affects SNAP deduction eligibility and ABAWD exemptions; affects TANF incapacity determination |

States can modify program relevance mappings via overlay — a state might have different income counting rules for a state-administered program.

### How it connects to the adapter pattern

The form definition sits alongside the other contract artifacts:

| Artifact | What it defines | Who uses it |
|----------|----------------|-------------|
| **OpenAPI spec** | Data schemas (what answers look like) | All three personas |
| **Form definition YAML** | Questions, conditions, program requirements (what to ask and when) | Applicant, caseworker |
| **State machine YAML** | Application lifecycle (draft → submitted → under_review → ...) | Caseworker, system |
| **Rules YAML** | Condition-based decisions (assignment, priority) | System |

The form definition is the **data collection contract**. Any frontend — web app, mobile app, in-person intake tool — interprets the form definition to present the right questions in the right order with the right conditions. States customize the form via overlays (add questions, change conditions, add sections).

Section-level `requiredForPrograms` is evaluated against each member's `programsApplyingFor`. If Jane is applying for SNAP + Medicaid, she sees sections required by either program. If her child is applying for Medicaid only, the child sees only Medicaid-required sections. Program relevance annotations are also scoped per member — when reviewing the child's income, only Medicaid relevance is shown since that's the only program the child is applying for.

The mock server could serve the form definition via a `GET /forms/integrated-application` endpoint and evaluate conditions for a given application state via `POST /forms/integrated-application/evaluate` (returns which sections and questions are active given the current answers and each member's selected programs).

### What the form definition does NOT do

- **Rendering** — it defines structure and logic, not layout, styling, or UX. A section with 3 questions could be rendered as a single page, a multi-step wizard, or a paper form.
- **Storage** — answers are stored via the data model APIs (POST income records, PATCH member fields), not through the form engine.
- **Determination** — the form collects data; the eligibility system evaluates it.

### Translations

The form definition uses a default locale for labels and descriptions. Translation files provide overrides per locale, keyed by section and question ID:

```yaml
# forms/translations/integrated-application.es.yaml
locale: es
sections:
  identity:
    title: Información Personal
    questions:
      name:
        label: "¿Cuál es su nombre legal completo?"
      dateOfBirth:
        label: "¿Cuál es su fecha de nacimiento?"
      ssn:
        label: "¿Cuál es su número de Seguro Social?"
  citizenship:
    title: Ciudadanía e Inmigración
    questions:
      citizenshipStatus:
        label: "¿Cuál es su estado de ciudadanía?"
        options:
          us_citizen: Ciudadano estadounidense
          us_national: Nacional estadounidense
          permanent_resident: Residente permanente
          qualified_noncitizen: No ciudadano calificado
          other_noncitizen: Otro no ciudadano
      immigrationDocumentType:
        label: "¿Qué tipo de documento de inmigración tiene?"
```

Translation files follow a consistent pattern: `forms/translations/{form-id}.{locale}.yaml`. The mock server merges translations at request time based on an `Accept-Language` header or `?locale=es` parameter. Enum option labels, section titles, question labels, and descriptions are all translatable. Validation messages and error text follow the same pattern.

States can add translations via overlay — both for new languages and for overriding default translations (e.g., adjusting terminology to match a state's preferred phrasing).

### Authoring experience

Form definitions can be authored as a pair of tables — one for sections and one for questions:

**Section table:**

| Section | Scope | Required For | Description |
|---------|-------|-------------|-------------|
| Identity | per member | SNAP, Medicaid, TANF | Name, DOB, SSN, demographics |
| Citizenship | per member | SNAP, Medicaid, TANF | Citizenship status, immigration documents |
| Income | per member | SNAP, Medicaid, TANF | Employment, self-employment, unearned income |
| Tax Filing | per member | Medicaid | Filing status, dependents, MAGI deductions |
| Housing | per household | SNAP | Address, rent/mortgage, utilities |

**Question table (per section):**

| Section | Question ID | Label | Type | Required | Show When | Programs |
|---------|------------|-------|------|----------|-----------|----------|
| Identity | name | What is your full legal name? | name | yes | — | all |
| Identity | dateOfBirth | What is your date of birth? | date | yes | — | all |
| Identity | ssn | What is your Social Security number? | ssn | yes | — | all |
| Citizenship | citizenshipStatus | What is your citizenship status? | enum | yes | — | all |
| Citizenship | immigrationDocumentType | What type of immigration document do you have? | enum | no | status != us_citizen | all |
| Tax Filing | willFileTaxes | Will you file a federal tax return? | boolean | yes | — | Medicaid |
| Tax Filing | filingJointly | Will you file jointly with your spouse? | boolean | no | willFileTaxes = yes | Medicaid |

The "Show When" column uses plain English conditions. A conversion script maps these to JSON Logic. The "Programs" column populates `relevantToPrograms`. Translations are authored in a separate spreadsheet with columns for each locale.

---

## 6. Review Tracking

Caseworkers review submitted applications by section per person. Review tracking is a separate lightweight resource — it records review status without modifying the underlying data.

### SectionReview resource

```
GET  /applications/:appId/reviews              — all reviews for this application
POST /applications/:appId/reviews              — mark a section as reviewed
GET  /applications/:appId/reviews?memberId=... — reviews for a specific member
```

```yaml
SectionReview:
  type: object
  required: [id, applicationId, sectionId, status, createdAt, updatedAt]
  properties:
    id:
      type: string
      format: uuid
    applicationId:
      type: string
      format: uuid
    sectionId:
      type: string
      description: References a section from the form definition (e.g., "identity", "income")
    memberId:
      type: string
      format: uuid
      description: For per-member sections. Null for per-household sections.
    status:
      type: string
      enum: [pending, approved, needs_correction, waived]
    reviewedById:
      type: string
      format: uuid
    reviewedAt:
      type: string
      format: date-time
      description: When the review decision was made. Distinct from updatedAt which changes on any modification.
    reviewNote:
      type: string
    createdAt:
      type: string
      format: date-time
    updatedAt:
      type: string
      format: date-time
```

### Review workflow

1. Application is submitted — system creates `SectionReview` records based on each member's `programsApplyingFor`. Jane (SNAP + Medicaid) gets reviews for all SNAP-required and Medicaid-required sections. Her child (Medicaid only) gets reviews only for Medicaid-required sections. Household-level sections (housing, household composition) get one review record each.
2. Caseworker opens the application — sees all members with their required sections and review status
3. Caseworker reviews "Income for Jane" — sees program relevance annotations for SNAP and Medicaid (Jane's programs). Reviews "Income for Child" — sees only Medicaid relevance (child's program). Marks each `approved` or `needs_correction`.
4. When all required sections for all members are approved, the application can proceed to eligibility determination

Because review tracking is section-based and sections are shared across programs, a caseworker reviews "Income for Jane" once — that review covers Jane's income for SNAP, Medicaid, and any other program that requires income data.

### Program views during review

While the caseworker reviews a section once, the review UI uses the form definition's program relevance annotations to show which data points matter for which programs. This helps the caseworker understand the impact of what they're reviewing without duplicating the review itself.

The caseworker can optionally filter or highlight by program ("show me what matters for SNAP") while still working from the single canonical dataset. The `SectionReview` approval covers all of that member's programs — there's no need for per-program review records. Since each member may be applying for different programs, the relevance annotations shown during review are scoped to that member's `programsApplyingFor`.

---

## 7. Program Requirements

The form definition captures which sections are required per program. This mapping serves three purposes:

1. **Applicant** — form engine shows only relevant sections based on selected programs
2. **Caseworker** — review dashboard creates review records only for required sections
3. **Eligibility system** — can verify all required data is present before evaluating

### Federal-level requirements

| Section | SNAP | Medicaid | TANF |
|---------|------|----------|------|
| Identity | Required | Required | Required |
| Household Composition | Required | Required | Required |
| Citizenship & Immigration | Required | Required | Required |
| Income | Required | Required | Required |
| Expenses | Required | Conditional | Conditional |
| Assets & Resources | Required | Conditional | Required |
| Health & Disability | Conditional | Required | Conditional |
| Tax Filing | — | Required | — |
| Education & Training | Conditional | — | Conditional |
| Housing | Required | — | — |

**Required** = always needed for this program. **Conditional** = needed based on other answers (e.g., expenses are relevant to Medicaid only for non-MAGI groups). **—** = not needed for this program at the federal level.

States may modify this mapping via overlay — for example, a state might require education information for Medicaid if the state runs a training program that affects eligibility.

---

## 8. Relationship to Existing Schemas

The current Application schema (`openapi/components/application.yaml`) nests all eligibility data inside `HouseholdMember`, resulting in a single massive object with 70+ ancillary schemas. This proposal recommends restructuring:

### What changes

| Current | Proposed | Rationale |
|---------|----------|-----------|
| `HouseholdMember` contains everything | `ApplicationMember` with nested 1:1 objects + separate API resources for collections | Reduces object size, enables independent CRUD for collections |
| Employment, self-employment, unearned income inline on member | `Income` API resource with `type` discriminator | Variable cardinality, independent CRUD |
| `ResourceInfo` with inline arrays of accounts, vehicles, etc. | `Asset` API resource with `type` discriminator | Variable cardinality, independent CRUD |
| `ExpenseInfo` on member + `HouseholdExpenses` on application | `Expense` API resource with optional `memberId` | Unifies member-level and household-level expenses |
| `ApplicationScreeningFlags` drives conditional logic | Form definition YAML captures conditions declaratively | Portable, customizable, interpretable by any frontend |
| No review tracking | `SectionReview` API resource | Enables per-section per-person review workflow |

### What stays the same

- `Application` as the top-level container
- `Person` as the persistent identity record (separate from application)
- Nested 1:1 objects like `citizenshipInfo`, `disabilityInfo`, `educationInfo` on the member
- The overlay system for state customization

### Migration consideration

The existing Application schema can coexist with the restructured model during a transition period. The current nested structure effectively represents a "snapshot" of all data — this is useful for application submission (send everything at once). The restructured API resources are useful for incremental data entry and caseworker review. Both views can be supported: the nested snapshot as a read-only projection, and the API resources as the primary read/write interface.
