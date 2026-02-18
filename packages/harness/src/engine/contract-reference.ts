export const REFERENCE_CONTENT = `\
# ── Form Contract Reference ─────────────────────────────
# Everything you can put in a .form.yaml layout file.

# ── Top-Level Structure ──────────────────────────────────

form:
  id: my-form                       # unique identifier (kebab-case)
  title: My Form                    # display title
  schema: Application               # data model object name
  scope: california                 # state scope (resolves schema file)
  layout: wizard                    # wizard | review | reference

  # wizard  — multi-page stepper with Next/Back (uses Create schema)
  # review  — single-page accordion (uses Update schema)
  # reference — read-only table (requires columns)

  role: caseworker                    # access role (applicant | caseworker | reviewer)
  annotations: [federal, california]  # annotation layers to load
  pages:
    - id: section-id
      title: Section Title
      expanded: true                # review only: start open (default: true)
      fields: [...]

# ── Field Definition ──────────────────────────────────────

- ref: household.members.0.firstName  # dot-path into the data model
  component: text-input
  width: half                     # full (default) | half | third | two-thirds
  hint: Legal first name          # helper text below the label

# Components: text-input | date-input | radio | select
#             checkbox-group | field-array

# ── Custom Labels ────────────────────────────────────────
# Override display text for enum values (radio/select/checkbox-group).

- ref: citizenshipStatus
  component: select
  labels:
    citizen: U.S. Citizen
    permanent_resident: Permanent Resident

- ref: consentToVerifyInformation
  component: radio
  labels:
    "true": "Yes"                   # quotes required for boolean keys
    "false": "No"

# ── Inline Permissions ───────────────────────────────────
# Per-field, per-role overrides. Values: editable | read-only | masked | hidden

- ref: household.members.0.ssn
  component: text-input
  permissions:
    applicant: editable
    caseworker: editable
    reviewer: masked

# ── Repeatable Field Group (field-array) ─────────────────
# Sub-field refs are relative — qualified at runtime.

- ref: household.members
  component: field-array
  min_items: 1                      # minimum rows
  max_items: 10                     # maximum rows
  fields:
    - ref: firstName                # → household.members.0.firstName
      component: text-input
      width: half
    - ref: lastName
      component: text-input
      width: half

# ── Conditional Visibility ───────────────────────────────

# Simple condition:
- ref: immigrationDocumentType
  component: text-input
  show_when:
    field: citizenshipStatus
    not_equals: citizen             # equals | not_equals

# JSON Logic (compound):
- ref: immigrationDocumentNumber
  component: text-input
  show_when:
    jsonlogic:
      and:
        - "!=": [{ var: citizenshipStatus }, citizen]
        - "!=": [{ var: immigrationDocumentType }, ""]

# ══════════════════════════════════════════════════════════
# Reference Layout — Column Configuration
# ══════════════════════════════════════════════════════════
# The reference layout renders a read-only table.
# Each column pulls data from one of four namespaces.

  columns:
    - from: <namespace>.<path>
      label: Column Header

# ── Namespace: field ─────────────────────────────────────
# Properties of the field definition itself.

    - from: field.ref               # dot-path (e.g. household.members.firstName)
    - from: field.component         # text-input, select, etc.
    - from: field.label             # auto-generated label from ref
    - from: field.hint              # hint text
    - from: field.width             # full, half, third, two-thirds

# ── Namespace: schema ────────────────────────────────────
# OpenAPI property info from the resolved spec.

    - from: schema.type             # string, integer, boolean, array
    - from: schema.format           # date, email, etc.
    - from: schema.enum             # comma-separated enum values
    - from: schema.description      # OpenAPI description

# ── Namespace: annotation ────────────────────────────────
# Layer-qualified: annotation.<layer>.<property>
# Layers come from the annotations: [...] list above.

    - from: annotation.federal.label       # field label
    - from: annotation.federal.source      # data source (applicant, system, derived)
    - from: annotation.federal.statute     # federal statute reference
    - from: annotation.federal.programs.SNAP  # "Required" or empty

    - from: annotation.california.statute  # state statute reference
    - from: annotation.california.notes    # state-specific notes
    - from: annotation.california.programs.CalFresh
    - from: annotation.california.programs.Medi-Cal (MAGI)

    - from: annotation.colorado.statute
    - from: annotation.colorado.notes
    - from: annotation.colorado.programs.CO SNAP
    - from: annotation.colorado.programs.LEAP

# To see all available program names, check the annotation
# files in the reference tabs.

# ── Namespace: permissions ───────────────────────────────
# Resolved permission level for a role.

    - from: permissions.applicant   # editable | read-only | masked | hidden
    - from: permissions.caseworker
    - from: permissions.reviewer

# ══════════════════════════════════════════════════════════
# Permissions Policy (separate file)
# ══════════════════════════════════════════════════════════

role: caseworker
defaults: editable
fields:
  socialSecurityNumber: masked

# ══════════════════════════════════════════════════════════
# Test Data (separate file — mirrors the data model)
# ══════════════════════════════════════════════════════════

programsAppliedFor: [SNAP, Medicaid_MAGI]
household:
  size: 2
  members:
    - firstName: Jane
      dateOfBirth: "1990-01-15"     # ISO 8601
      ssn: "123-45-6789"
`;
