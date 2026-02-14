# Federal Benefits Data Model — Companion Guide

This document explains how to read `federal-benefits-data-model.csv` and provides guidance for subject-matter expert (SME) review.

## How to read the spreadsheet

### Columns

| Column | Description |
|--------|-------------|
| **Entity** | The data entity (table/object) this field belongs to. |
| **Relationship** | Cardinality relative to the parent entity (e.g., `1..N per Household` means one or more per household). Only populated on the entity's header row. |
| **Field** | The machine-readable field name. |
| **Label** | Human-readable field label. |
| **DataType** | `string`, `number`, `integer`, `boolean`, `date`, `datetime`, `uuid`, `enum`, `text`. `text` is used for longer free-form content (e.g., notes, descriptions) while `string` is used for shorter structured values (e.g., names, codes). |
| **EnumValues** | Pipe-delimited list of allowed values when DataType is `enum`. |
| **Source** | Where the value comes from (see [Source types](#source-types) below). |
| **Program columns** | `Required` means the program needs this field for eligibility determination. Blank means the program does not use this field. |
| **Policy/Statute** | Federal regulation or statute citation. |
| **Notes** | Implementation guidance, edge cases, or cross-references. |
| **OBBBA (H.R.1)** | Flags fields affected by the One Big Beautiful Bill Act (signed July 4, 2025). Values: `New field` (added to reflect OBBBA requirements), `Modified` (existing field whose rules, enums, or derivation changed), or blank (unaffected). See [OBBBA changes](#obbba-hr1-changes) below. |
| **Application/Enrollment** | `Required` means this field is needed for the application or enrollment process itself, regardless of whether it is used for eligibility determination. This column distinguishes process-required fields (signatures, consent, voter registration) from eligibility-required fields. Fields can be Required in both program columns and this column. |

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
Application (1 per submission)
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

The Application entity captures process-level fields needed for the submission itself — signatures, consent, voter registration, delivery preferences — rather than eligibility determination. Household.applicationId links each household to its application.

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

The **Application/Enrollment** column works differently from program columns. It tracks whether a field is needed for the application process itself (signatures, consent, voter registration) rather than for any specific program's eligibility determination. This creates three patterns:

- **Program columns = Required, Application/Enrollment = blank** — Most fields fall here. These are eligibility fields: programs need them to determine if someone qualifies, but they are not application-process requirements. Examples: `grossAmount`, `dateOfBirth`, `citizenshipStatus`.
- **Program columns = blank, Application/Enrollment = Required** — Process-only fields needed for legal, administrative, or compliance reasons, not for any program's eligibility rules. Examples: `signatureOfApplicant`, `race`, `ethnicity`, `voterRegistrationOffered`.
- **Both = Required** — Fields needed for both. Example: `applicationDate` is Required for SNAP (determines first-month proration and processing deadline) and also Required for Application/Enrollment (every application needs a received date).

### OBBBA (H.R.1) changes

The **One Big Beautiful Bill Act** (OBBBA, H.R.1) was signed into law on July 4, 2025. It made significant changes to SNAP and Medicaid eligibility rules. The data model has been updated to reflect these changes, and the `OBBBA (H.R.1)` column flags every affected row.

#### Modified fields

| Field | Entity | What changed |
|-------|--------|-------------|
| `citizenshipStatus` | Person | Added `cofa_citizen` enum value. SNAP non-citizen eligibility narrowed: only US citizens, US nationals, LPRs with 5+ years, refugees/asylees, Cuban/Haitian entrants, and COFA citizens (Compact of Free Association) remain eligible. Most other qualified non-citizen categories removed from SNAP. |
| `isElderlyOrDisabled` | Person | Updated derivation note: OBBBA changed the LIHEAP/SNAP HCSUA (Heating and Cooling Standard Utility Allowance) interaction so LIHEAP receipt no longer confers HCSUA for non-elderly/non-disabled households. |
| `isAbawdEligible` | Person | ABAWD (Able-Bodied Adults Without Dependents) age range raised from 18–54 to 18–64. Dependent child exemption narrowed from under 18 to under 14. |
| `abawdExemptionReason` | Person | Enum values overhauled: removed `homeless`, `veteran`, `aged_out_foster_care`. Added `indian_tribal_member`. Remaining exemptions: `pregnant`, `physically_mentally_unfit`, `caring_for_child_under_14`, `indian_tribal_member`, `exempt_from_work_registration`, `other`, `none`. |
| `workRequirementMet` | Eligibility Determination | Now marked Required for Medicaid (MAGI) in addition to SNAP and TANF. Reflects the new Medicaid community engagement requirement. |

#### New fields

| Field | Entity | DataType | Purpose |
|-------|--------|----------|---------|
| `isIndianTribalMember` | Person | boolean | Required for SNAP (ABAWD exemption) and Medicaid MAGI (community engagement exemption). Indian/tribal members are exempt from both SNAP work requirements and the new Medicaid community engagement requirement. |
| `medicaidWorkExemptionReason` | Person | enum | Captures the reason a person is exempt from the Medicaid community engagement requirement (80 hours/month for ages 19–64, effective January 2027). 16 exemption categories including pregnant, disabled, caretaker of dependent, student, tribal member, and others. |
| `medicaidWorkHoursPerMonth` | Person | integer | The number of qualifying community engagement hours per month. Must reach 80 hours to satisfy the requirement. |

#### Key OBBBA policy changes summarized

**SNAP:**
- ABAWD time limits now apply to ages 18–64 (previously 18–54)
- Dependent child exemption: child must be under 14 (previously under 18)
- Removed ABAWD exemptions for homeless individuals, veterans, and former foster youth
- Added ABAWD exemption for Indian/tribal members
- Non-citizen SNAP eligibility significantly narrowed
- LIHEAP receipt no longer confers HCSUA for non-elderly/non-disabled households
- Internet/broadband costs explicitly prohibited from SNAP shelter deduction (OBBBA Section 10104)

**Medicaid:**
- New community engagement requirement: 80 hours/month of qualifying activities for ages 19–64 in Medicaid expansion population, effective January 1, 2027
- 9 exemption categories (pregnant, medically frail/disabled, caretaker of dependent child under 6, full-time student, receiving unemployment benefits, tribal member, under 19, age 55+, and others)
- Six-month redetermination cycle for expansion population (previously 12 months)
- Address verification required at application and redetermination (OBBBA Section 71107)
- Non-citizen eligibility narrowing — potential restrictions on Medicaid coverage for some non-citizen categories (OBBBA Sections 71108–71109; implementing regulations pending)

---

## SME review guidance

This data model was generated through analysis of federal statutes and regulations (CFR, USC). It has not been reviewed by a subject-matter expert. The sections below document confidence levels, known gaps, and areas that need particular attention.

### Confidence levels by program

| Program | Confidence | Notes |
|---------|------------|-------|
| **SNAP** | High | Well-defined federal rules in 7 CFR 273. Updated for OBBBA (July 2025) ABAWD and non-citizen eligibility changes. Enum values for deduction types and exemptions may be incomplete at the state level. |
| **Medicaid (MAGI)** | High | Clear federal framework in 42 CFR 435.603. Updated for OBBBA community engagement requirement (effective Jan 2027). Exemption categories sourced from the enacted statute; implementing regulations may add detail. |
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

#### AssetTransfer entity

Asset transfer tracking (Medicaid look-back, SNAP transfer penalties) is currently captured with three fields on the Asset entity: `recentAssetTransfer`, `transferDate`, and `transferAmount`. For Medicaid LTC with a 60-month look-back (DRA 2005), a household may have multiple transfers over that period. An SME should evaluate whether a dedicated `AssetTransfer` entity (0..N per Person) with fields for transfer date, amount, recipient, fair market value, and penalty period calculation would be more appropriate.

#### Spousal impoverishment completeness

The spousal impoverishment protections (42 USC 1396r-5) are partially captured via `institutionalizationDate` and `maritalStatus`, but the full data requirements — community spouse resource allowance, minimum monthly maintenance needs allowance, protected resources — may need additional fields. An SME familiar with Medicaid long-term care should review whether the current model captures enough for states to calculate the community spouse protected amount.

#### Additional OBBBA provisions pending review

Several OBBBA provisions may affect data collection beyond what is currently modeled:

- **Section 10104** — Prohibits internet/broadband costs from SNAP shelter deduction. The model's Expense entity should ensure internet costs are not included in shelter expense types. Notes updated but an SME should verify no separate tracking field is needed.
- **Sections 71107** — Requires address verification at Medicaid application and redetermination. Current `address*` fields exist but verification workflow requirements may need additional data elements.
- **Sections 71108–71109** — Potential narrowing of Medicaid non-citizen eligibility. `citizenshipStatus` and `citizenshipEligible` notes updated but implementing regulations are still pending.

### Issues found and fixed during review

The following issues were identified during self-review passes and have already been corrected in the spreadsheet.

#### Initial review (round 1)

1. **AuthorizedRepresentative cardinality** — Changed from `0..1` to `0..N` per Person. SNAP explicitly allows separate authorized representatives for application and benefit receipt (7 CFR 273.2(n)(3)).
2. **Missing field: institutionalizationDate** — Added to Person. The date of institutionalization is required for the spousal impoverishment resource snapshot (42 USC 1396r-5(c)(1)).
3. **Missing field: medicarePart** — Added to HealthCoverage. Distinguishes Medicare Part A/B/C/D, which is required for Medicaid Savings Programs (QMB, SLMB, QI).
4. **employerInsuranceAvailable/Affordable incorrectly Required for Non-MAGI** — Removed. These are MAGI/marketplace concepts; non-MAGI tracks existing coverage via HealthCoverage (third-party liability).
5. **receivesOtherBenefits not Required for WIC** — Fixed. WIC uses adjunctive eligibility from SNAP/Medicaid/TANF (7 CFR 246.7(d)).
6. **transferredInLast36Months renamed to recentAssetTransfer** — Field name was misleading since Medicaid LTC uses a 60-month look-back (DRA 2005), not 36 months.

#### Comprehensive review (round 2)

**A. Column alignment errors (5 fields):**
WIC-specific fields (isBreastfeeding, deliveryDate, isPostpartum, nutritionalRiskLevel, nutritionalRiskConditions) had Required in the SSI column instead of the WIC column — a one-column offset error. Moved to the correct column.

**B. Missing Required markers (~44 fixes):**
- WorkActivity fields (activityType, hoursPerWeek, startDate, endDate) marked Required for TANF
- Person fields marked Required for TANF: maritalStatus (two-parent household rules), isPregnant (mandatory exemption)
- Person.maritalStatus and Person.isPregnant marked Required for SNAP (deduction eligibility, exemptions)
- Household.size marked Required for WIC
- BenefitParticipation fields marked Required for WIC (adjunctive eligibility) and Summer EBT (categorical eligibility)
- HealthCoverage fields marked Required for CHIP (prior coverage waiting period)
- Sponsor fields marked Required for SSI (deeming)
- Person.citizenshipStatus marked Required for LIHEAP
- Asset transfer fields (recentAssetTransfer, transferDate, transferAmount) marked Required for SNAP and Non-MAGI Medicaid
- Burial-related asset fields (burialPlot, burialFund) marked Required for SNAP and Non-MAGI Medicaid
- Person.ssn marked Required removed from WIC (not required for WIC eligibility)

**C. Missing fields (19 new fields added):**
- `Person.abawdCountableMonths` — Tracks months used toward SNAP ABAWD time limit (3 in 36 months)
- `Person.studentExemptionReason` — Why a student is exempt from SNAP higher-education exclusion
- `Person.wicParticipantCategory` — WIC category: pregnant, breastfeeding, postpartum, infant, child (determines food package)
- `Person.deemedResourcesFromSpouse` — SSI resources deemed from ineligible spouse
- `Person.deemedResourcesFromParent` — SSI resources deemed from parent (for child under 18)
- `Person.deemedIncomeFromSponsor` — Income deemed from sponsor to non-citizen (42 USC 1631(e))
- `Person.medicaidEnrollmentGroup` — Medicaid enrollment group determines applicable rules (expansion, poverty-level, medically needy, etc.)
- `Person.tanfSanctionStatus` — Whether TANF benefits are currently sanctioned (affects household benefit amount)
- `Person.twoParentFamily` — Whether this is a two-parent family for TANF purposes
- `Household.energySupplierName` — LIHEAP: name of energy supplier
- `Household.energySupplierAccountNumber` — LIHEAP: energy supplier account number
- `Household.primaryHeatingFuelType` — LIHEAP: type of fuel used for primary heating
- `Person.methamphetamineProductionConviction` — Lifetime SNAP/TANF ban (21 USC 862a)
- `Person.alcoholAbusePattern` — SSI alcohol/drug evaluation requirement
- `Person.priorEvictionDate` — Section 8: date of prior drug-related eviction (24 CFR 982.553)
- `Person.magiHouseholdSize` — MAGI household size (may differ from physical household)
- `Person.medicaidRedeterminationMonths` — Months since last Medicaid redetermination
- `Asset.homeEquityValue` — Equity value of primary residence (SNAP: countable if over $500K threshold)
- `Asset - Type Requirements: able_account` — ABLE account (tax-advantaged disability savings, excluded by SSI/Medicaid)

**D. Enum and structural fixes:**
- `qualifiedAlienCategory` enum harmonized with `citizenshipStatus` enum values
- `familyType` enum: added `elderly`, `disabled`, `near_elderly` for Section 8
- `institutionalStatus` enum: added `icf_iid` (Intermediate Care Facility for Individuals with Intellectual Disabilities)
- `Asset.type` enum: added `able_account`
- `medicaidWorkExemptionReason` enum: added `receiving_unemployment_benefits`, `formerly_in_foster_care`, `recently_incarcerated`
- `race` field: Notes updated to indicate array type (multiple values per person)
- `netAmount` field: Notes updated with program-specific income counting methodology
- `citizenshipStatus` field: Notes updated for OBBBA Medicaid narrowing provisions
- Deeming derivation logic documented in Notes for deemedResourcesFromSpouse/Parent and deemedIncomeFromSponsor
- `citizenshipEligible` derivation Notes updated for OBBBA non-citizen changes
- `categoricallyEligible` derivation Notes updated: added FDPIR and free/reduced school meals for Summer EBT

**E. Documentation and conditional requirements (~23 fields):**
- Added "Required when" conditions to Notes for conditional fields (e.g., "Required when non-citizen", "Required when type is vehicle", "Required for ABAWD-subject individuals")
- Added format note for SSN field (9-digit, no dashes)
- Added policy citations for maritalStatus (7 CFR 273.1(b)) and isPregnant (7 CFR 273.2(c)(3))

#### Application entity addition (round 3)

Added the Application entity (12 entities total) with 16 data fields and the Application/Enrollment column:

- `applicationDate` — Date received; determines SNAP proration and processing deadlines
- `programsAppliedFor` — Which programs the applicant is requesting
- `isExpedited` — SNAP expedited processing screening (7 CFR 273.2(i))
- `signatureOfApplicant` — Attestation of truthfulness
- `signatureDate`, `signatureMethod` — When and how signed (in-person, electronic, telephonic, mark)
- `rightsAndResponsibilitiesAcknowledged` — Program rights/responsibilities acknowledgment
- `penaltyOfPerjuryAcknowledged` — Perjury attestation
- `consentToVerifyInformation` — Authorization to verify with employers, agencies, etc.
- `consentToShareData` — Authorization for cross-program data sharing
- `voterRegistrationOffered`, `voterRegistrationResponse` — NVRA Section 7 compliance (52 USC 20506)
- `noticeDeliveryPreference` — Mail, email, portal, or text
- `paymentMethodPreference` — EBT card, direct deposit, or check
- `accommodationNeeded` — Whether applicant needs disability-related accommodation (ADA Title II / Section 504)
- `accommodationType` — Type of accommodation requested (large print, braille, sign language interpreter, TTY, etc.)

Person.race and Person.ethnicity marked Required for Application/Enrollment (civil rights compliance, not eligibility). Household.preferredLanguage and Household.primaryContactPhone also marked Required for Application/Enrollment (Title VI language access and applicant reachability). Household.applicationId FK added.

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

1. **OBBBA (H.R.1) changes** — Filter the `OBBBA (H.R.1)` column for "New field" and "Modified" rows. Verify that: (a) the SNAP ABAWD age expansion, exemption changes, and non-citizen narrowing are accurately captured; (b) the Medicaid community engagement requirement exemption categories are complete; (c) OBBBA Sections 10104 (internet costs), 71107 (address verification), 71108–71109 (non-citizen narrowing) are fully addressed; (d) no other OBBBA provisions affecting eligibility data collection were missed. The implementing regulations for Medicaid community engagement (effective Jan 2027) may not yet be finalized — compare against the latest CMS guidance.
2. **Non-MAGI Medicaid column** — Lowest confidence among established programs. Verify Required/blank mappings for the aged, blind, and disabled pathways. Check whether spousal impoverishment and spend-down data requirements are complete (see known issue above).
3. **Asset transfer tracking** — Evaluate whether the current 3-field approach (recentAssetTransfer, transferDate, transferAmount) is sufficient or whether a dedicated AssetTransfer entity is needed for the 60-month Medicaid look-back.
4. **LIHEAP column** — Weakest federal requirements. An SME familiar with common state LIHEAP implementations should verify which fields are genuinely federally required vs. commonly collected by states.
5. **TANF column** — Federal framework is correct but thin. Verify that no federal TANF data requirements are missing.
6. **Application entity** — Verify that application process fields (signatures, consent, voter registration) are complete. Confirm no federally mandated application questions are missing.
7. **Enum values** — Spot-check critical enums (citizenshipStatus, Income.type, Asset.type) against current federal guidance. Pay particular attention to `abawdExemptionReason` and `medicaidWorkExemptionReason` which were added/updated for OBBBA.
8. **Cross-program interactions** — Verify categorical/adjunctive eligibility mappings (BenefitParticipation type requirements). Confirm that the programs listed as triggers for categorical eligibility are complete and correct.
9. **Derived field logic** — Review Notes column for all `derived` and `assessed` fields to confirm the derivation logic is accurate.
