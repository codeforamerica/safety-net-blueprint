# Contract Metadata

This document is the architecture reference for the contract metadata system in the Safety Net
Blueprint. It covers the policy registry, domain annotation files, TypeScript client integration,
runtime API endpoints, validation, and overlay extensibility. Vendor systems and standards
compared: FHIR (HL7 extensions and implementation guides), NIEM (National Information Exchange
Model), ServiceNow GRC (Compliance Management), IBM Cúram (Rules and Evidence framework),
Salesforce Public Sector Solutions (RegulatoryCode model), Collibra (data governance graph), and
Apache Atlas (data catalog classification model).

## Overview

Contract metadata is a cross-cutting system that attaches machine-readable information — regulatory
citations, data classifications, program-specific requirements — to specific elements in contract
artifacts (OpenAPI schemas, path operations, state machine actions, AsyncAPI events).

Without this system, a state adopting the blueprint has no machine-readable way to know which
fields are required by regulation vs. design choice, which data is sensitive, or which operations
have compliance implications. That information currently lives in prose documentation, inline
descriptions, and explorer config files — none of which are queryable, versionable alongside the
contracts, or consumable by UX clients at runtime.

The system has two distinct layers:

- **Policies** — standalone regulatory and program rules, defined independently of any contract
  element, managed in a platform-level registry. A policy exists whether or not any element
  references it.
- **Annotations** — element-keyed metadata that attaches information to a specific contract
  element. An annotation can reference a policy, carry a data classification, or include other
  metadata. Annotations belong to a domain.

A policy becomes an annotation when it is attached to an element.

## Contract files

| File | Purpose |
|------|---------|
| `platform-registry-policies.yaml` | Baseline policy definitions, keyed by stable ID |
| `platform-registry-policies-{name}.yaml` | Additional policy files when the baseline grows large |
| `schemas/platform-registry-policies-schema.yaml` | JSON Schema that validates all policy files |
| `{domain}-annotations.yaml` | Domain-specific annotations, keyed by element path |
| `{domain}-annotations-{name}.yaml` | Additional annotation files when a domain's file grows large |
| `schemas/annotations-schema.yaml` | JSON Schema that validates all annotation files |

Multiple policy files and multiple annotation files per domain are supported. The validator,
TypeScript generator, and mock server discover all matching files by glob pattern and merge them.
This allows splitting large files without changing how any tooling consumes them. See
[Decision 1](#decision-1-separate-policy-and-annotation-files) and
[Decision 3](#decision-3-multiple-file-support).

## Annotation file format

Each domain has one or more annotation files (`{domain}-annotations.yaml`). The file is organized
into three sections, each corresponding to a category of contract artifact:

```yaml
$schema: "./schemas/annotations-schema.yaml"
version: "1.0"
domain: intake

schema:
  ApplicationMember.ssn:
    dataClassification: [pii, fti]
    programs:
      snap: required
      medicaid: preferred
    policies: [snap-ssn-disclosure]

  Application.submittedAt:
    programs: [snap]           # shorthand — defaults to required
    policies: [snap-processing-clock, medicaid-processing-clock]

operations:
  submit:
    policies: [snap-application-filing-date]

  applications.interview:
    programs: [snap]
    policies: [snap-interview-requirement]

events:
  intake.application.submitted:
    policies: [snap-application-filing-date, snap-electronic-verification]
```

### Sections

**`schema`** — Annotations for OpenAPI component schema fields and JSON Schema properties. Keys use
dot notation to identify the field path within its schema (e.g., `ApplicationMember.ssn`).

**`operations`** — Annotations for state machine actions and OpenAPI path operations. State machine
actions and OpenAPI path operations are two representations of the same behavioral concept — a
state machine action `submit` and its corresponding `POST /applications/{id}/submit` path operation
are the same thing. Keys are the action or operation identifier.

**`events`** — Annotations for AsyncAPI event channels. Keys are the event type identifier.

### Annotation properties

Standard annotation properties at the baseline:

| Property | Type | Description |
|----------|------|-------------|
| `policies` | `string[]` | Policy IDs from the registry that apply to this element |
| `dataClassification` | `string[]` | Data sensitivity classifications from the baseline vocabulary (e.g., `pii`, `fti`, `phi`). See [Decision 8](#decision-8-dataclassification-vocabulary). |
| `programs` | `string[] \| object` | Programs this field or operation is relevant to. Shorthand array form defaults all entries to `required`. Map form allows per-program strength: `required`, `preferred`, or `optional`. See [Decision 9](#decision-9-programs-property-and-strength). |

Additional annotation properties can be added by states via overlay without schema changes — the
leaf level is open by design. See [Decision 4](#decision-4-open-annotation-vocabulary).

## Policy file format

Policy files (`platform-registry-policies.yaml`, `platform-registry-policies-{name}.yaml`) define
standalone regulatory and program rules keyed by stable ID:

```yaml
$schema: "./schemas/platform-registry-policies-schema.yaml"
version: "1.0"

policies:
  snap-ssn-disclosure:
    citation: "7 CFR § 273.2(g)"
    citationUrl: "https://www.ecfr.gov/current/title-7/section-273.2"
    description: "Agency must accept any application on the date of first contact. The date received is the application filing date."
    programs: [snap]

  medicaid-processing-clock:
    citation: "42 CFR § 435.912"
    citationUrl: "https://www.ecfr.gov/current/title-42/section-435.912"
    description: "Medicaid determination must be made within 45 days of application (90 days for disability-based)."
    programs: [medicaid]

  snap-processing-clock:
    citation: "7 CFR § 273.2"
    citationUrl: "https://www.ecfr.gov/current/title-7/section-273.2"
    description: "SNAP determination must be made within 30 days of application."
    programs: [snap]
```

Policy IDs are stable across versions. Renaming a policy ID is a breaking change — add a new ID
and deprecate the old one rather than renaming.

Policies are not domain-scoped. The same policy can be referenced by annotations in any domain.
The `programs` field indicates which benefit programs the policy applies to; omit it if the policy
applies universally.

## Validation

Annotation and policy files are validated as part of `npm run validate`. Two validation levels apply:

**Schema validation (error)** — The file must conform to the JSON Schema defined in the
corresponding schema file. Structural errors (missing required fields, wrong types, malformed
values) fail the build.

**Cross-reference validation (warning)** — Every key in the `schema`, `operations`, and `events`
sections is checked against the corresponding contract artifact for the domain. A key that does not
match any element in the contract produces a warning, not an error. This is intentional: states
may annotate elements that exist only in their overlay, not in the baseline.

The cross-reference validator resolves keys as follows:

| Section | Resolves against |
|---------|-----------------|
| `schema` | OpenAPI component schema field paths in `{domain}-openapi.yaml` |
| `operations` | State machine action IDs in `{domain}-state-machine.yaml` and OpenAPI operationIds |
| `events` | AsyncAPI channel addresses in `{domain}-asyncapi.yaml` |

Policy ID references in `policies: [...]` are also validated — referencing a policy ID that does
not exist in any policy file produces a warning.

## Overlay extensibility

The resolve pipeline processes annotation and policy files alongside all other contract artifacts.
States extend baseline annotations and policies using the standard overlay mechanism — the same
JSONPath-based overlay actions used for OpenAPI specs.

Examples of what states can do via overlay:

```yaml
# Add a state-specific annotation to an existing element
- target: $.schema['ApplicationMember.countyCode']
  file: intake-annotations.yaml
  update:
    dataClassification: [pii]
    requiredForPrograms: [snap]

# Add a state-specific policy
- target: $.policies.state-county-residency
  file: platform-registry-policies.yaml
  update:
    citation: "State Admin Code § 123.4"
    description: "County residency must be verified for all applicants."
    programs: [snap]

# Reference a state-specific policy from a baseline element
- target: $.schema['ApplicationMember.countyCode'].policies
  file: intake-annotations.yaml
  append:
    - state-county-residency
```

States can add new annotation properties not in the baseline vocabulary without schema changes,
because the annotation leaf level uses `additionalProperties: true`.

## TypeScript client integration

The contracts package generates typed static exports from annotation and policy files as part of
`npm run clients:generate`. These exports are available alongside the generated API types:

```typescript
import { IntakeAnnotations, Policies } from '@codeforamerica/safety-net-blueprint-contracts';

// Element annotation lookup
const ssn = IntakeAnnotations.schema['ApplicationMember.ssn'];
// ssn.dataClassification → ['pii', 'fti']
// ssn.policies → ['snap-ssn-disclosure']

// Policy lookup
const policy = Policies['snap-ssn-disclosure'];
// policy.citation → '7 CFR § 273.2(g)'
// policy.description → '...'
```

The exports are typed `as const` objects — no runtime fetch required. Overlays are resolved at
generation time, so a state's generated client reflects their customized annotations and policies.

`IntakeAnnotations` mirrors the annotation file structure with `schema`, `operations`, and `events`
sub-objects. `Policies` is a flat map across all policy files.

## Runtime API

Runtime endpoints serve resolved annotation and policy data for tooling that cannot bundle the
compiled client.

**Policies** are served at the platform level, since they are not domain-scoped:

```
GET /platform/registry/policies
GET /platform/registry/policies/{policyId}
```

**Annotations** are served at the domain level, since they always belong to a domain:

```
GET /intake/annotations
GET /intake/annotations?section=schema&element=ApplicationMember.ssn
```

> **Future decision:** annotation endpoint placement at the domain level is an initial assertion.
> If a cross-domain use case emerges — for example, a compliance dashboard querying annotations
> across all domains — the endpoint may move to a platform-level location. See
> [Decision 5](#decision-5-annotation-endpoint-placement).

> **Future capability:** reverse-lookup — querying from the policy direction ("what elements
> reference this policy?") — is not defined in the initial implementation. The current design
> accommodates it without breaking changes: it can be added as either an `expand=elements`
> parameter on the existing policy endpoint, or a new platform-level annotation query endpoint.
> The specific shape is an implementation decision deferred until a compliance dashboard use case
> is in scope.

Both endpoints return resolved data — baseline merged with active overlays. The response shape
matches the structure of the TypeScript static exports so access patterns are consistent.

## Key design decisions

| # | Decision | Summary |
|---|----------|---------|
| 1 | [Separate policy and annotation files](#decision-1-separate-policy-and-annotation-files) | Policies are standalone; annotations reference them by ID |
| 2 | [Annotation file sections](#decision-2-annotation-file-sections) | Three sections map to artifact types: schema, operations, events |
| 3 | [Multiple file support](#decision-3-multiple-file-support) | Both policy and annotation files support splitting for scale |
| 4 | [Open annotation vocabulary](#decision-4-open-annotation-vocabulary) | Leaf level is open; states add properties via overlay without schema changes |
| 5 | [Annotation endpoint placement](#decision-5-annotation-endpoint-placement) | Domain-scoped initially; platform-level is a future option |
| 6 | [Element path format](#decision-6-element-path-format) | FHIR-style dot notation; no array brackets; applies to the field wherever it appears |
| 7 | [Citation URL](#decision-7-citation-url) | Optional `citationUrl` alongside the display `citation` string |
| 8 | [dataClassification vocabulary](#decision-8-dataclassification-vocabulary) | Extensible baseline vocabulary; baseline values schema-enforced, states can extend |
| 9 | [programs property and strength](#decision-9-programs-property-and-strength) | Renamed from `requiredForPrograms`; map form with per-program strength; shorthand defaults to `required` |

---

### Decision 1: Separate policy and annotation files

**Status:** Decided: B

**What's being decided:** Whether policies (regulatory citations, program rules) should be defined
inline within annotation files or in separate standalone files, so that the same regulation can be
referenced from multiple elements across multiple domains without duplication.

**Considerations:**
- ServiceNow GRC models regulatory content as a five-level hierarchy: Authority Document → Citation
  → Policy → Control Objective → Control. Each level has a stable sys_id that other records
  reference. This is the industry-standard pattern for compliance management: regulations are
  first-class objects, not text embedded in element records.
- Salesforce Public Sector Solutions uses `RegulatoryCode` and `RegulatoryAuthority` as standalone
  objects with stable Salesforce IDs. Compliance relationships are separate join records — the same
  regulation can be linked to many records without copying its text. This is the closest analogue to
  our `policies` → `annotations` separation.
- Collibra represents policies and rules as asset types in a knowledge graph. "Complies with"
  relations connect a Policy asset to a Column asset — the same policy object can be connected to
  many columns across many tables without duplication.
- IBM Cúram embeds policy logic inside Rule Sets and Rule Classes — there are no stable reference
  IDs for individual rules, making cross-domain citation impossible. Cúram rules are executable
  logic, not metadata. This is the pattern to avoid: once a regulation is encoded as executable
  logic without a stable ID, it cannot be referenced by ID, queried, or displayed to users.
- A policy like "7 CFR § 273.2(g)" applies to multiple elements (the `submit` operation, the
  `submittedAt` field, the `application.submitted` event) and potentially across multiple domains.
  Defining it once and referencing it by ID avoids drift between copies and enables a registry API.

**Options:**
- **(A)** Policies defined inline in annotation files alongside the element they annotate.
- **(B)** ✓ Policies defined in separate `platform-registry-policies*.yaml` files, referenced by
  stable ID from annotation files.

---

### Decision 2: Annotation file sections

**Status:** Decided: schema / operations / events

**What's being decided:** How to organize annotations within a domain annotation file — whether to
use a flat map of all elements or separate sections by artifact type, so the validator knows which
contract artifact to resolve each key against.

**Considerations:**
- Field-level annotations cover data sensitivity and program requirements on individual fields, but
  regulatory compliance also applies to actions and events. The filing date requirement (7 CFR §
  273.2) governs when the `submit` operation occurs — that is a property of the operation, not of
  any individual field it touches. Similarly, an event like `intake.application.submitted` carries
  regulatory significance for downstream consumers that cannot be derived from its payload fields
  alone. Limiting annotations to the `schema` section would make operation-level and event-level
  compliance invisible to tooling.
- Apache Atlas distinguishes between entity types when attaching classifications: a classification
  can be attached to a Table, a Column, or a Process entity, each resolved against a different
  metadata store. This is the closest analogue to the blueprint's three artifact types — each
  section resolves against a different contract artifact file, enabling targeted validation.
- FHIR uses a flat extension model: every element in a resource can carry extensions identified by
  canonical URL. FHIR does not distinguish between field and operation extensions because FHIR
  resources are data structures, not API contracts. The blueprint's contracts span three distinct
  artifact types (OpenAPI schemas, state machines, AsyncAPI events), which require separate
  resolution logic — a flat map without sections would make the validator unable to determine which
  artifact to check a key against.
- NIEM separates element-level from message-level metadata at the schema layer — structurally
  similar to the `schema` vs. `operations` split.
- No vendor system groups state machine actions and API path operations as the same annotatable
  element. This is a blueprint-specific design choice that follows from how the blueprint works:
  state machines generate path operations, so `submit` as an action and `POST /applications/{id}/submit`
  as a path are the same behavioral event from a regulatory perspective. Annotating them separately
  would create duplicate annotations with identical content.

**Options:**
- **(A)** Flat map of all elements with type prefixes (`schema:ApplicationMember.ssn`).
- **(B)** ✓ Three top-level sections: `schema`, `operations`, `events`.

**Decision:** `operations` covers both state-machine-driven operations (keyed by action ID) and
non-state-machine path operations (keyed by operationId). State machine actions and their
generated path operations share a key because they represent the same behavioral event. This is a
blueprint-specific grouping with no direct vendor equivalent.

---

### Decision 3: Multiple file support

**Status:** Decided: glob discovery

**What's being decided:** Whether policy and annotation data must fit in a single file per type,
or whether multiple files can be merged at build time so large registries can be split by program
or topic without changing how tooling consumes them.

**Considerations:**
- ServiceNow GRC organizes Authority Documents by program (SNAP CFR, Medicaid CFR, HIPAA, etc.) as
  separate records — there is no single monolithic policy file. File-per-program organization is the
  standard pattern in compliance management.
- Collibra and Apache Atlas both use database-backed stores where policies and classification types
  are individual records rather than entries in a single file. The multi-file pattern mirrors this:
  each file is conceptually a batch of records, not a schema definition.
- A single `platform-registry-policies.yaml` becomes unwieldy as the baseline grows to cover all
  programs (SNAP, Medicaid, CHIP, TANF, WIC) with their CFR citations. File-per-program
  organization improves maintainability.
- The resolve pipeline already processes all YAML files in the contracts directory, so discovery
  by glob pattern requires no pipeline changes.

**Options:**
- **(A)** Single file per type; splitting requires a schema change.
- **(B)** ✓ Multiple files supported via glob discovery (`platform-registry-policies*.yaml`,
  `{domain}-annotations*.yaml`). Files are merged by the validator and TypeScript generator.

---

### Decision 4: Open annotation vocabulary

**Status:** Decided: additionalProperties open

**What's being decided:** Whether the annotation vocabulary is closed (only baseline-defined
properties allowed) or open (states can add domain-specific properties without schema changes),
given that the baseline cannot anticipate every annotation type states will need.

**Considerations:**
- FHIR's extensibility model is built on an open vocabulary: any element can carry any extension
  identified by a canonical URL. Profiles define expected extensions but do not prohibit others.
  This is the foundational design principle behind FHIR's wide adoption in a fragmented healthcare
  ecosystem — implementers can extend without forking.
- Apache Atlas allows users to register custom Classification types with user-defined attributes at
  any time, without schema changes. Existing classifications and their attachments are unaffected
  when a new attribute is added to the type definition.
- Collibra allows custom attribute types to be added to any asset type without schema changes.
  Custom attributes are addable at any level of the governance model, from domain down to column.
- All three of these systems treat the base vocabulary as a starting point, not a ceiling. Closing
  the vocabulary would create adoption friction for states — they would need to propose baseline
  changes for every state-specific annotation type, and blueprint upgrades could conflict with their
  custom properties.

**Options:**
- **(A)** Closed vocabulary; states must propose new annotation types for inclusion in the baseline.
- **(B)** ✓ Open vocabulary; annotation leaf objects use `additionalProperties: true`. States add
  properties via overlay. The baseline defines standard properties; extensions are valid without
  schema changes.

---

### Decision 5: Annotation endpoint placement

**Status:** Decided: B (initial assertion; subject to revision)

**What's being decided:** Whether the runtime annotation endpoint belongs at the domain level
(`/intake/annotations`) or at the platform level (`/platform/annotations?domain=intake`).

**Considerations:**
- Annotations always belong to a domain — `intake-annotations.yaml` annotates elements in intake
  contract artifacts. The domain-scoped URL is consistent with how other intake endpoints are
  namespaced and makes the ownership clear.
- A platform-level endpoint would be more consistent with the policy registry
  (`/platform/registry/policies`) and would enable cross-domain annotation queries from a single
  endpoint. Collibra and Apache Atlas both expose lineage and classification data through a single
  platform-level API regardless of which domain or schema the asset belongs to — a pattern that
  supports compliance dashboards and cross-domain reporting.
- No cross-domain annotation use case has been identified yet. The domain-scoped placement is
  sufficient for known use cases (caseworker review UX, compliance reporting per domain).

**Options:**
- **(A)** Platform-level: `/platform/annotations?domain=intake`
- **(B)** ✓ Domain-scoped: `/intake/annotations` — consistent with domain ownership; simpler for
  the initial implementation.

**Deferred:** If a cross-domain use case emerges, revisit this placement. Moving from domain-scoped
to platform-level is a breaking change to the API surface.

---

### Decision 6: Element path format

**Status:** Decided: B

**What's being decided:** What format annotation keys use to identify a specific field within a
schema — so that `ApplicationMember.ssn` unambiguously refers to the `ssn` field on the
`ApplicationMember` schema, and the format is stable as the underlying file structure changes.

**Considerations:**
- FHIR StructureDefinition uses identical dot-notation syntax (`Patient.name.given`) for element
  paths in profiles and implementation guides. It is the established standard for element-level
  metadata in interoperability specifications.
- JSONPath (`$.components.schemas.ApplicationMember.properties.ssn`) is unambiguous and machine-
  precise but verbose and couples the key to the OpenAPI document structure. If the OpenAPI file
  layout changes, annotation keys break.
- JSON Pointer (`/components/schemas/ApplicationMember/properties/ssn`) has the same coupling
  problem as JSONPath.
- Type-prefixed strings (`schema:ApplicationMember.ssn`) duplicate the section context already
  provided by the annotation file's `schema:` section.

**Array notation convention:** For fields that appear within array items (e.g., `Application.members[].ssn`),
array brackets are omitted — the path is `ApplicationMember.ssn`. The annotation applies to the
field wherever it appears within an array, consistent with how FHIR handles repeated elements
(`Patient.name.given` annotates `given` within every `name` repetition).

**Options:**
- **(A)** JSONPath — unambiguous but verbose and file-structure-coupled.
- **(B)** ✓ FHIR-style dot notation (`ApplicationMember.ssn`) — concise, file-structure-independent,
  the established standard for element-level metadata.
- **(C)** Type-prefixed string (`schema:ApplicationMember.ssn`) — redundant given section context.

---

### Decision 7: Citation URL

**Status:** Decided: B

**What's being decided:** Whether a policy's `citation` field is a display string only, or whether
an optional machine-resolvable URL is also carried so that tooling can link directly to the
regulation text.

**Considerations:**
- FHIR uses canonical URIs as the primary identifier for everything; display text is secondary.
  Treating a citation as a display string only means tooling must parse the string to construct
  a URL, which is fragile.
- ServiceNow GRC stores both a display citation field and a source URL as separate first-class
  fields on Authority Document records. The URL is optional but recommended.
- The eCFR (Electronic Code of Federal Regulations) maintains stable, dereferenceable URLs for
  every CFR section (`https://www.ecfr.gov/current/title-7/section-273.2`), maintained by NARA/GPO.
- NIEM has no native citation model; citations are prose only.

**Options:**
- **(A)** Display string only (original approach) — simple; tooling must parse the string to link.
- **(B)** ✓ Add optional `citationUrl` alongside the `citation` display string — additive, zero
  breaking change, enables tooling to link directly to eCFR without parsing.
- **(C)** Replace `citation` with a structured object `{ display, url }` — cleaner structurally
  but requires nested YAML and breaks any consumer reading `policy.citation` as a string.

---

### Decision 8: dataClassification vocabulary and inheritance

**Status:** Decided: C / override model

**What's being decided:** Two related questions: (1) whether `dataClassification` values are open
strings, a closed enum, or a defined baseline vocabulary that is schema-enforced but extensible;
and (2) whether a classification on a parent schema object propagates to its sub-properties, and
how sub-property annotations interact with parent annotations.

**Scope boundary:** `dataClassification` describes what data intrinsically is — a fact about the
schema element defined by regulation (`fti` by IRC § 6103, `phi` by HIPAA 45 CFR § 164). It is
not an access control rule. Who is permitted to view or modify a classified field is a runtime
concern for the consuming system; the annotation provides the classification signal that drives
that decision.

**Considerations:**
- FHIR DS4P (Data Segmentation for Privacy) binds security labels to a controlled value set with
  binding strength. `extensible` strength means: use the defined vocabulary; only extend it if it
  does not cover your case. This is the established pattern for classification metadata in
  interoperability specifications.
- NIEM IC-ISM uses a closed enum (`U`, `C`, `S`, `TS`) defined by the Intelligence Community.
  No extensions allowed — appropriate for national security but too rigid for benefits programs.
- Apache Atlas allows organizations to register custom Classification types freely, with
  propagation to child entities through lineage. No baseline vocabulary is enforced; propagation
  is lineage-based, not schema-structural.
- Collibra ships suggested classification types but does not enforce them.
- Fully open strings make typos and inconsistent casing invisible at build time (`PII` vs `pii`
  vs `personally-identifiable` all pass validation).
- Annotating every sub-property of a large schema object individually is verbose. Annotating
  `ApplicationMember` as `[pii]` once and having sub-properties inherit it is the natural model
  for objects where every field shares the parent's classification.

**Baseline vocabulary:** `pii`, `fti`, `phi`, `phi-behavioral`, `cjis`. States may add values via
overlay per [Decision 4](#decision-4-open-annotation-vocabulary).

**Inheritance and override:** A `dataClassification` on a parent schema key (e.g.,
`ApplicationMember`) propagates to all sub-properties. A sub-property with its own explicit
`dataClassification` annotation overrides the parent entirely — the field's annotation is the
complete, authoritative statement. There is no merging: if `ApplicationMember` is `[pii]` and
`ApplicationMember.ssn` explicitly annotates `[pii, fti]`, the field is `[pii, fti]`; the parent
`[pii]` does not add to it. This is consistent with CSS cascade and the overlay mechanism: the
most specific annotation wins.

**Options:**
- **(A)** Fully open strings — no validation; inconsistencies invisible until runtime.
- **(B)** Closed enum — validates at build time; states cannot add values without baseline change.
- **(C)** ✓ FHIR-style extensible binding with override inheritance — baseline values are
  schema-enforced (caught at `npm run validate`); states extend via overlay; parent annotations
  propagate to sub-properties and are overridden (not merged) by explicit sub-property annotations.

---

### Decision 9: programs property and strength

**Status:** Decided: B

**What's being decided:** How to express which benefit programs a field or operation is relevant
to, and whether the strength of that relevance (regulatory mandate vs. recommendation vs. optional)
is part of the annotation.

**Considerations:**
- FHIR binding strength (`required`, `extensible`, `preferred`, `example`) provides four levels of
  enforcement for value set bindings. The pattern of separating "which programs" from "how required"
  mirrors FHIR's separation of binding target from binding strength.
- ServiceNow GRC control status (`mandatory`, `advisory`, `informational`) distinguishes regulatory
  mandates from recommendations — mandatory controls fail compliance checks while advisory controls
  generate warnings. A caseworker UX client needs the same distinction to know whether to mark a
  field as required.
- The original property name `requiredForPrograms` conflates two concerns: which programs care
  about this field, and how much they require it. Renaming to `programs` makes the strength
  explicit rather than implied by the property name.

**Shorthand form:** A flat array (`programs: [snap, medicaid]`) is equivalent to all entries at
`required` strength. The shorthand is for the common case; the map form is used when strengths differ.

**Baseline strength vocabulary:** `required` (regulatory mandate), `preferred` (strong baseline
recommendation), `optional` (relevant to the program but not required). Default when omitted is
`required`. States may add strength values per [Decision 4](#decision-4-open-annotation-vocabulary).

**Options:**
- **(A)** Flat array `requiredForPrograms: [snap]` — simple; no strength distinction; name implies
  all entries are required.
- **(B)** ✓ Renamed to `programs`; map form with per-program strength; shorthand array defaults to
  `required`. Aligns with FHIR binding strength and ServiceNow mandatory/advisory distinction.

