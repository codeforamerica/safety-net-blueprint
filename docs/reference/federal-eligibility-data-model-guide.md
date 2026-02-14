# Federal Eligibility Data Model — Companion Guide

This document explains how to read `federal-eligibility-data-model.csv` and provides guidance for subject-matter expert (SME) review.

## How to read the spreadsheet

### Columns

| Column | Description |
|--------|-------------|
| **Entity** | The data entity (table/object) this field belongs to. |
| **Relationship** | Cardinality relative to the parent entity (e.g., `1..N per Household` means one or more per household). Only populated on the entity's header row. |
| **Field** | The machine-readable field name. |
| **Label** | Human-readable field label. |
| **DataType** | `string`, `number`, `integer`, `boolean`, `date`, `datetime`, `uuid`, `enum`, `text`. |
| **EnumValues** | Pipe-delimited list of allowed values when DataType is `enum`. |
| **Source** | Where the value comes from (see [Source types](#source-types) below). |
| **Program columns** | `Required` means the program needs this field for eligibility determination. Blank means the program does not use this field. |
| **Policy/Statute** | Federal regulation or statute citation. |
| **Notes** | Implementation guidance, edge cases, or cross-references. |

### Source types

| Source | Meaning | Example |
|--------|---------|---------|
| `applicant` | Provided by the applicant on the application form. | First name, income amount |
| `derived` | Calculated from other fields in the data model. Not entered by anyone. | Age (from dateOfBirth), net income (from gross minus deductions) |
| `assessed` | Determined by a qualified professional during the eligibility process. Not on the application form itself, but collected during processing. | Nutritional risk level (WIC), level of care assessment (Medicaid) |
| `system` | Generated automatically by the system. | IDs, timestamps |

Derived and assessed fields are included because they represent data elements the system must store and programs must evaluate, even though applicants don't directly provide them. An SME reviewing the model should verify the derivation logic described in the Notes column.

### Entity header rows

Rows where only Entity and Relationship are populated are **section headers**. They introduce an entity and describe its cardinality. For example:

```
Person,1..N per Household,,,,,,,,,,,,,,,,,,
```

This means: every Household has one or more Person records.

### Type requirement rows

Several entities include rows labeled `{Entity} - Type Requirements`. **These are not separate database entities.** They are a documentation device showing which specific enum values within a type field each program cares about.

For example, under the Income entity, the field `type` is an enum with values like `employment`, `self_employment`, `social_security_oasdi`, etc. The "Income - Type Requirements" rows show that SNAP requires disclosure of employment income, self-employment income, Social Security, etc., while SSI requires in-kind support and maintenance but Summer EBT does not.

Read these rows as: "If this program column says Required, then applicants for that program must be asked about this specific type of income/asset/expense/benefit."

The entities that use type requirement rows:

| Entity | What the type rows represent |
|--------|------------------------------|
| Income - Type Requirements | Which income types each program requires disclosure of |
| Asset - Type Requirements | Which asset types each program requires disclosure of |
| Expense - Type Requirements | Which expense types each program uses for deductions or eligibility |
| BenefitParticipation - Type Requirements | Which other-benefit types trigger categorical or adjunctive eligibility for each program |

### Entity relationships

```
Application
  └── Household (1 per Application)
        ├── Person (1..N per Household)
        │     ├── Income (0..N per Person)
        │     ├── Asset (0..N per Person)
        │     ├── Expense (0..N per Person)
        │     ├── BenefitParticipation (0..N per Person)
        │     ├── HealthCoverage (0..N per Person)
        │     ├── Sponsor (0..1 per Person)
        │     ├── AuthorizedRepresentative (0..N per Person)
        │     ├── WorkActivity (0..N per Person)
        │     └── Eligibility Determination (1 per Person per Program)
        └── (Household-level fields: address, shelter costs, utilities, etc.)
```

Note: Application is not modeled as an entity in the spreadsheet. The Household is the root entity.

### Conditional "Required" fields

Some fields are marked Required but are only applicable under certain conditions. The Notes column describes these conditions. Common patterns:

- **"Required when non-citizen"** — Immigration fields are only needed when `citizenshipStatus` is not `us_citizen` or `us_national`.
- **"Required if [other field] is true"** — For example, `drugFelonyConvictionDate` is only needed when `drugFelonyConviction` is true.
- **"For [type] type"** — Vehicle fields on Asset are only relevant when `type` is `vehicle`. Employer fields on Income are only relevant for `employment` type.

### Program columns

The 10 program columns represent federal benefit programs:

| Column | Program | Administering agency |
|--------|---------|---------------------|
| SNAP | Supplemental Nutrition Assistance Program | USDA FNS |
| Medicaid (MAGI) | Medicaid using Modified Adjusted Gross Income rules | CMS |
| Medicaid (Non-MAGI) | Medicaid for aged, blind, and disabled individuals | CMS |
| TANF | Temporary Assistance for Needy Families | ACF |
| SSI | Supplemental Security Income | SSA |
| WIC | Special Supplemental Nutrition Program for Women, Infants, and Children | USDA FNS |
| CHIP | Children's Health Insurance Program | CMS |
| Section 8 Housing | Housing Choice Voucher Program | HUD |
| LIHEAP | Low Income Home Energy Assistance Program | ACF |
| Summer EBT | Summer Electronic Benefits Transfer | USDA FNS |

**Medicaid (MAGI) vs. Medicaid (Non-MAGI):** MAGI Medicaid covers most non-elderly, non-disabled adults and children using tax-based income rules, no asset test, and tax-household composition. Non-MAGI Medicaid covers aged (65+), blind, and disabled individuals using SSI-methodology income counting, an asset/resource test, and different household rules. They have substantially different data requirements, which is why they are separate columns.

### What "Required" and blank mean

- **Required** — The federal program uses this data element in its eligibility determination. An application serving this program should collect it.
- **Blank** — The federal program does not use this data element. It can be omitted from applications targeting only this program.

Important: "Required" reflects federal rules only. States may require additional data elements or may waive collection of some federal fields through waivers or simplified reporting. This model is a federal baseline.

---

## SME review guidance

This data model was generated through analysis of federal statutes and regulations (CFR, USC). It has not been reviewed by a subject-matter expert. The sections below document confidence levels, known gaps, and areas that need particular attention.

### Confidence levels by program

| Program | Confidence | Notes |
|---------|------------|-------|
| **SNAP** | High | Well-defined federal rules in 7 CFR 273. Income, asset, deduction, and disqualification rules are thoroughly documented. Enum values for deduction types and exemptions may be incomplete at the state level. |
| **Medicaid (MAGI)** | High | Clear federal framework in 42 CFR 435.603. MAGI income counting and tax-household composition rules are well-specified. |
| **Medicaid (Non-MAGI)** | Medium | Newly added column. Core pathways (aged, blind, disabled) and asset test are well-understood. Confidence is lower for: spend-down calculation details, spousal impoverishment data requirements, transfer-of-assets penalty specifics, and the variation between states that use SSI methodology vs. 209(b) methodology. |
| **TANF** | Medium | Federal rules set a framework (42 USC 601-619, 45 CFR 260-265) but TANF is the most state-defined program. Work activity types and time limit rules are federal; almost everything else (income limits, asset limits, benefit amounts, exemptions) is state-determined. |
| **SSI** | High | Fully federal program administered by SSA with detailed rules in 20 CFR 416. Income counting, resource limits, deeming, and exclusions are thoroughly specified. The five-step disability evaluation is simplified in this model (see known gap below). |
| **WIC** | Medium-High | Eligibility categories and adjunctive eligibility are clear (7 CFR 246). Nutritional risk assessment is simplified — real WIC assessments use detailed anthropometric/biochemical criteria not fully captured here. |
| **CHIP** | Medium-High | Follows Medicaid MAGI framework for income. Waiting period rules and interaction with employer coverage are well-specified. State-level variation in income limits is not captured (federal model only). |
| **Section 8 Housing** | Medium | HUD rules (24 CFR 982) define the framework. Income counting follows 24 CFR Part 5. PHAs have significant local discretion in preferences, screening criteria, and waiting list management, none of which is captured. |
| **LIHEAP** | Low | LIHEAP is a block grant with minimal federal eligibility requirements (42 USC 8624). States define almost all eligibility criteria. The Required markings for LIHEAP are the weakest in the model — most represent "states commonly require this" rather than "federal law mandates this." |
| **Summer EBT** | Medium | Relatively new program (2024). Categorical eligibility pathways are clear. School enrollment verification requirements may evolve as states implement the program. |

### Known issues requiring SME review

#### Hidden array: nutritionalRiskConditions

The `nutritionalRiskConditions` field on Person is modeled as a single enum but the Notes column acknowledges it should be an array — a person may have multiple simultaneous risk conditions. An SME should decide whether to break this into a separate `NutritionalRisk` entity (0..N per Person) or keep it as an array-valued field with a note for implementors.

#### Simplified disability model

The SSI disability determination is a complex five-step sequential evaluation (20 CFR 416.920) involving medical evidence, residual functional capacity, past work, age-education-experience grid rules, and more. The data model simplifies this to `disabilityStatus` (boolean), `disabilityType` (text), `meetsGainfulActivityTest` (boolean), and `disabilityDuration` (boolean). This is appropriate for an initial application/screening, but an SME should confirm whether additional disability-related fields are needed for processing.

### Issues found and fixed during review

The following issues were identified during a self-review pass and have already been corrected in the spreadsheet:

1. **AuthorizedRepresentative cardinality** — Changed from `0..1` to `0..N` per Person. SNAP explicitly allows separate authorized representatives for application and benefit receipt (7 CFR 273.2(n)(3)).
2. **Missing field: institutionalizationDate** — Added to Person. The date of institutionalization is required for the spousal impoverishment resource snapshot (42 USC 1396r-5(c)(1)).
3. **Missing field: medicarePart** — Added to HealthCoverage. Distinguishes Medicare Part A/B/C/D, which is required for Medicaid Savings Programs (QMB, SLMB, QI).
4. **employerInsuranceAvailable/Affordable incorrectly Required for Non-MAGI** — Removed. These are MAGI/marketplace concepts; non-MAGI tracks existing coverage via HealthCoverage (third-party liability).
5. **receivesOtherBenefits not Required for WIC** — Fixed. WIC uses adjunctive eligibility from SNAP/Medicaid/TANF (7 CFR 246.7(d)).
6. **transferredInLast36Months renamed to recentAssetTransfer** — Field name was misleading since Medicaid LTC uses a 60-month look-back (DRA 2005), not 36 months.

### Enum completeness

Enum values throughout the model are based on federal regulation categories, but many may be incomplete:

| Field | Concern |
|-------|---------|
| `citizenshipStatus` | Immigration status categories are complex; USCIS recognizes more statuses than listed. The current enum covers the main eligibility-relevant categories but may miss edge cases. |
| `Income.type` | The "other" catch-all exists, but some programs recognize additional specific income types (e.g., strike benefits, garnished wages, in-kind contributions beyond SSI's ISM). |
| `Asset.type` | Cryptocurrency and digital assets are not explicitly listed. They would fall under "other" but may warrant a dedicated type given increasing prevalence. |
| `Expense.type` | The model captures the main deduction categories for SNAP, Section 8, and Medicaid spend-down. State-specific deduction types are not included. |
| `preferredLanguage` | The 12-language enum plus "other" covers the most common US languages but is not exhaustive. Implementation should support free-text for "other." |
| `WorkActivity.activityType` | Based on the 12 federally countable TANF activities (45 CFR 261.30). States may define additional state-specific activities. |
| `HealthCoverage.coverageType` | May need expansion for Indian Health Service (IHS), PCIP, state-specific programs. |

### Policy citation accuracy

CFR and USC citations were sourced from the most recent available versions. Specific concerns:

- **SNAP citations (7 CFR 273):** High confidence. These are stable and well-documented.
- **Medicaid citations (42 CFR 435):** High confidence for MAGI rules. Medium confidence for non-MAGI rules — some citations reference general provisions rather than the most specific subsection.
- **TANF citations (42 USC 608, 45 CFR 261):** Medium confidence. Federal TANF law sets parameters but states define most details through state plans.
- **SSI citations (20 CFR 416):** High confidence. SSI rules are comprehensive and stable.
- **Section 8 citations (24 CFR 5, 24 CFR 982):** Medium confidence. HUD rules are spread across multiple parts and PHAs have local flexibility.
- **LIHEAP citations (42 USC 8624):** Low confidence. There is essentially one federal statute with minimal specificity; most LIHEAP rules are state-defined.
- **Summer EBT citations (42 USC 1762, 7 CFR 292):** Medium confidence. Program is new; regulations may have been updated since this model was created.

### Recommended SME review priorities

In order of impact:

1. **Non-MAGI Medicaid column** — Newest addition, lowest confidence. Verify Required/blank mappings for the aged, blind, and disabled pathways. Check whether spousal impoverishment and spend-down data requirements are complete.
2. **LIHEAP column** — Weakest federal requirements. An SME familiar with common state LIHEAP implementations should verify which fields are genuinely federally required vs. commonly collected by states.
3. **TANF column** — Federal framework is correct but thin. Verify that no federal TANF data requirements are missing.
4. **Hidden objects and missing fields** listed above — Confirm AuthorizedRepresentative cardinality, institutionalization date, Medicare parts.
5. **Enum values** — Spot-check critical enums (citizenshipStatus, Income.type, Asset.type) against current federal guidance.
6. **Cross-program interactions** — Verify categorical/adjunctive eligibility mappings (BenefitParticipation type requirements). Confirm that the programs listed as triggers for categorical eligibility are complete and correct.
7. **Derived field logic** — Review Notes column for all `derived` and `assessed` fields to confirm the derivation logic is accurate.
