export const REFERENCE_CONTENT = `\
# ── Form Contract Reference ─────────────────────────────
# Everything you can put in a .form.yaml layout file.

# ── Top-Level Structure ──────────────────────────────────

form:
  id: my-form                       # unique identifier (kebab-case)
  title: My Form                    # display title
  schema: Application               # data model object name
  layout:                           # composable layout (see below)
    navigation: step-indicator
    display: paginated
  role: caseworker                  # access role (applicant | caseworker | reviewer)
  annotations: [federal, california]  # annotation layers to load
  pages:
    - id: section-id
      title: Section Title
      expanded: true                # accordion only: start open (default: true)
      fields: [...]

# ══════════════════════════════════════════════════════════
# Form Layout
# ══════════════════════════════════════════════════════════
# Layout is a two-property object that controls navigation
# and content display independently.
#
#   layout:
#     navigation: <type>    # how users move between pages
#     display: <type>       # how page content is arranged
#
# ── navigation ───────────────────────────────────────────
#
#   step-indicator   USWDS StepIndicator with Next/Back buttons.
#                    Shows numbered progress steps across the top.
#                    Best for: applicant intake, sequential workflows.
#
#   side-nav         USWDS SideNav in a left sidebar (grid-col-3).
#                    Click any section to jump directly to it.
#                    Best for: caseworker review, long forms with
#                    non-linear access.
#
#   in-page          USWDS InPageNavigation — sticky right-side TOC
#                    that auto-highlights the current section on scroll.
#                    Pair with display: scrollable.
#                    Best for: read-through review, printing.
#
#   top-nav          USWDS Header with horizontal PrimaryNav links.
#                    Pages appear as top navigation items.
#                    Best for: dashboard-style layouts, shallow forms.
#
#   none             No navigation chrome. For accordion display,
#                    sections expand/collapse in place. For paginated,
#                    there are no page controls (single visible page).
#                    Best for: simple short forms, embedded views.
#
# ── display ──────────────────────────────────────────────
#
#   paginated        One page visible at a time. Navigation controls
#                    switch between pages.
#
#   scrollable       All pages rendered in sequence as <section>
#                    elements. Users scroll through the full form.
#
#   accordion        Each page is a collapsible USWDS Accordion section.
#                    All sections visible, individually expandable.
#
#   split-panel      Two form instances side by side (requires panels
#                    config). Used for comparing working copy vs original.
#                    Uses SplitPanelRenderer.
#
#   data-table       Read-only table view. Pages become row groups,
#                    columns are configurable (field, schema, annotation,
#                    permissions namespaces). Uses DataTableRenderer.
#                    Requires columns config (see Data Table section).
#                    source: contract (default) resolves rows from pages;
#                    source: api maps external data rows by key.
#                    Supports list-detail navigation via per-page
#                    detail config (see Detail Navigation section).
#
# ── Per-Page Display Override ─────────────────────────────
# Individual pages can override the form-level display:
#
#   pages:
#     - id: summary-table
#       title: Field Summary
#       display: data-table        # this page renders as a table
#       columns: [...]             # optional page-level column override
#     - id: personal-info
#       title: Personal Info       # inherits form-level display
#       fields: [...]
#
# ── Common Combinations ─────────────────────────────────
#
# Applicant wizard (step-by-step intake):
#   layout:
#     navigation: step-indicator
#     display: paginated
#
# Caseworker side-nav (click to jump between sections):
#   layout:
#     navigation: side-nav
#     display: paginated
#
# Scrollable with sticky TOC (review all at once):
#   layout:
#     navigation: in-page
#     display: scrollable
#
# Accordion review (expand/collapse sections):
#   layout:
#     navigation: none
#     display: accordion
#
# Simple scrollable (no nav, all sections visible):
#   layout:
#     navigation: none
#     display: scrollable
#
# Dashboard with top nav (horizontal page tabs):
#   layout:
#     navigation: top-nav
#     display: paginated
#
# Minimal paginated (no progress indicator):
#   layout:
#     navigation: none
#     display: paginated
#
# Side-by-side comparison:
#   layout:
#     navigation: step-indicator
#     display: split-panel
#   panels:
#     left:
#       label: Working Copy
#       mode: editable
#     right:
#       label: Original Submission
#       mode: readonly
#
# Side-by-side with side-nav:
#   layout:
#     navigation: side-nav
#     display: split-panel
#   panels:
#     left:
#       label: Working Copy
#       mode: editable
#     right:
#       label: Original Submission
#       mode: readonly
#
# Data table (read-only field reference):
#   layout:
#     navigation: none
#     display: data-table
#   columns:
#     - from: field.ref
#       label: Field
#     - from: schema.type
#       label: Type
#     - from: annotation.federal.programs.SNAP
#       label: SNAP

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
# Data Table — Column Configuration
# ══════════════════════════════════════════════════════════
# The data-table display renders a read-only table.
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
# Detail Navigation (list-detail)
# ══════════════════════════════════════════════════════════
# Per-page detail config for row-click navigation.
# Clicking a row shows a detail form with breadcrumb back-nav.
#
#   pages:
#     - id: applications
#       title: Applications
#       source: api
#       columns: [...]
#       detail:
#         form: application-intake    # ID of form contract for detail view
#         fetch: /api/applications/{id}  # API endpoint template
#
# The detail.form value must match the id of another form contract.
# The detail.fetch value is an endpoint template with {field} placeholders.

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
