# Form Description Contracts

## Summary

This effort defines a contract-driven specification for generating full-featured React forms from configuration files. Rather than hand-building forms for each public benefits program and state variation, teams will author declarative configuration (format TBD) that describes form structure, fields, and behavior. A rendering engine will consume these configurations and produce working React forms.

This approach extends the contract-driven philosophy already established in Safety Net Blueprint — where OpenAPI specs and overlays define API contracts — into the UI layer. The goal is to give program teams a way to define forms without writing React code, while still producing forms that are production-ready and accessible.

## Goals

- Enable non-frontend teams to define and modify forms through configuration
- Support state-specific form variations, consistent with the overlay model used for API contracts
- Produce forms that meet accessibility and usability standards out of the box
- Reduce duplication across programs that share similar form patterns (intake, eligibility, renewals)

## Guiding Principles

- **Approachable**: The configuration format must be easy to learn and use, minimizing onboarding time for engineers across all three team types
- **Scalable**: Must support expansive and complex form systems without the format becoming unwieldy or hitting capability ceilings
- **Contract-first**: The form description is the source of truth — rendering is an implementation detail derived from the contract

## Team / Staffing Considerations

Form description contracts will be authored and consumed by three distinct groups:

- **State engineers** (2) — State government staff building and maintaining program forms
- **Consultant engineers** (2) — Consultants supporting state teams on implementation
- **Outsourced engineering teams** — Full external teams building on the platform

## Requirements

### UI Framework

- Forms must render using [USWDS](https://designsystem.digital.gov/) components
- Preferred implementation is [@trussworks/react-uswds](https://github.com/trussworks/react-uswds)

### Field-Level Access Control

- The configuration format must provide a clear path to supporting field-level access patterns (e.g., controlling visibility and editability of individual fields based on role or context)

### Complex Form Features

- **Pagination / Wizard**: Multi-step form flows with navigation between pages
- **Dependent fields**: Fields whose options or behavior change based on the values of other fields
- **Conditional visibility**: Contextual showing and hiding of fields based on form state
- **Conditional logic**: Arbitrary conditional rules that affect form behavior

### Validation

- Validation is **not** a responsibility of the form description contracts
- Validation is handled by the existing TypeScript clients and API clients already produced by this project

## Approaches Under Consideration

### RJSF (React JSON Schema Form)

Forms are defined using standard JSON Schema for data structure plus a UI Schema for presentation. The library renders forms from these schemas and supports custom widgets and themes for component replacement. No native wizard/multi-page support — this must be built as a wrapper. MIT licensed. Largest community in this space (~14.5K GitHub stars).

### SurveyJS

Forms are defined using SurveyJS's own well-documented JSON format, which natively describes pages, conditional logic, and field dependencies in a single configuration. Supports custom renderers for component replacement. Wizard/multi-page forms are a first-class feature. MIT licensed (form library only; visual builder is commercial).

### Comparison

| | RJSF | SurveyJS |
|---|---|---|
| **Config format** | JSON Schema (standard) + UI Schema (proprietary) | SurveyJS JSON (proprietary, well-documented) |
| **Wizard / multi-page** | Build it yourself | Native, including conditional pages |
| **Conditional logic** | Supported via JSON Schema keywords | Native, purpose-built expression language |
| **USWDS integration** | Build custom theme (~2-4 weeks) | Build custom renderers (~2-4 weeks) |
| **Validation** | AJV-based, disableable | Own system, disableable via events |
| **License** | MIT | MIT (form library) |
| **Community** | ~14.5K stars, ~250-500K weekly downloads | ~4.7K stars, commercially backed team |
