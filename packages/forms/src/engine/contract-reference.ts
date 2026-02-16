export const REFERENCE_CONTENT = `\
# ── Form Contract Layout ─────────────────────────────────
# The layout tab defines pages, fields, and visibility rules.

form:
  id: my-form
  title: My Form
  schema: applications/ApplicationCreate  # Zod schema used for validation (via zodResolver)
  layout: wizard                  # wizard (multi-page) | review (accordion)
  pages:
    - id: basic-info
      title: Basic Information
      expanded: true              # review layout only: start open (default: true)
      fields: [...]

# ── Field Definition ──────────────────────────────────────

- ref: household.members.0.firstName  # dot-path into the data model
  component: text-input           # text-input | date-input | radio | select | checkbox-group
  width: half                     # full (default) | half | third | two-thirds
  hint: Legal first name          # helper text below the label

# ── Custom Labels (radio / select / checkbox-group) ───────
# Override the display text for enum values.
# Keys are the raw enum values; values are what the user sees.

- ref: household.members.citizenshipStatus
  component: select
  labels:                           # works with any enum values
    citizen: U.S. Citizen
    permanent_resident: Permanent Resident
    qualified_non_citizen: Qualified Non-Citizen

- ref: consentToVerifyInformation
  component: radio
  labels:
    "true": "Yes"                   # quotes required — without them YAML
    "false": "No"                   # parses true/false as booleans, not strings

# ── Inline Permissions (per-field, per-role) ──────────────

- ref: household.members.0.ssn
  component: text-input
  permissions:
    applicant: editable           # editable | read-only | masked | hidden
    caseworker: editable
    reviewer: masked

# ── Repeatable Field Group (field-array) ──────────────────
# Use field-array for repeatable rows (household members, addresses, etc.).
# Sub-field refs are relative — they get qualified at runtime.

- ref: household.members
  component: field-array
  hint: List all people in your household
  min_items: 1                        # minimum rows (prevents removing last)
  max_items: 10                       # maximum rows (hides Add button at limit)
  fields:
    - ref: firstName                  # becomes household.members.0.firstName
      component: text-input
      width: half
    - ref: lastName
      component: text-input
      width: half
    - ref: relationship
      component: select
      labels:
        spouse: Spouse
        child: Child
        parent: Parent
        sibling: Sibling
        other: Other

# ── Conditional Visibility: Simple ────────────────────────

- ref: household.members.immigrationDocumentType
  component: text-input
  show_when:
    field: citizenshipStatus
    not_equals: citizen           # equals | not_equals

# ── Conditional Visibility: JSON Logic (compound) ─────────

- ref: household.members.immigrationDocumentNumber
  component: text-input
  show_when:
    jsonlogic:
      and:
        - "!=":
            - var: citizenshipStatus
            - citizen
        - "!=":
            - var: immigrationDocumentType
            - ""

# ── Permissions Policy ────────────────────────────────────
# (Permissions tab)

role: caseworker                  # applicant | caseworker | reviewer
defaults: editable                # default permission for all fields
fields:                           # per-field overrides
  socialSecurityNumber: masked

# ── Test Data ─────────────────────────────────────────────
# (Test Data tab — mirrors the data model)

programsAppliedFor:
  - SNAP
  - Medicaid_MAGI
household:
  size: 2
  livingArrangement: rent
  members:
    - firstName: Jane
      lastName: Doe
      dateOfBirth: "1990-01-15"     # ISO 8601: YYYY-MM-DD
      ssn: "123-45-6789"
      gender: female                # from Zod enum
      race:                         # array for checkbox-group
        - white
        - asian
`;
