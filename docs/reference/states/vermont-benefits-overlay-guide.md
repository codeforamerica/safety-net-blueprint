# Vermont Benefits Overlay Guide

This guide explains how to read and use the [Vermont Benefits Overlay CSV](vermont-benefits-overlay.csv) alongside the [Federal Benefits Data Model](../federal-benefits-data-model.csv).

## How to Read the Overlay

The overlay CSV contains **only differences** from the federal baseline. It does not repeat unchanged fields.

### OverlayAction Values

| Action | Meaning |
|--------|---------|
| `update` | Modifies an existing federal field. Blank cells mean "same as federal" — only populated cells represent Vermont-specific differences. |
| `remove` | Vermont does not collect this field. The field exists in the federal model but is not used in Vermont's implementation. |
| `add` | A new Vermont-only field not present in the federal model. The Entity must exist in the federal model (e.g., Person, Household). |
| `add_program` | Introduces a state-only program with no federal counterpart. The program column (GA, EA, or EAA) is marked `Program`. |

### Blank Cell Rule

For `update` rows, **blank = same as federal**. Only cells that differ from the federal model are populated. This keeps the overlay compact and makes differences immediately visible.

### How to Cross-Reference

1. Open both the federal CSV and the Vermont overlay CSV
2. For each overlay row, find the matching **Entity + Field** pair in the federal CSV
3. Any populated cell in the overlay overrides the corresponding federal value
4. Any blank cell in the overlay means the federal value applies unchanged

## Vermont Program Mapping

Vermont implements all 10 federal programs, several under distinctive state names. Vermont's policy architecture includes notable structural differences — Dr. Dynasaur is one of the most generous children's health programs in the nation at 312% FPL, and Vermont has pursued universal health coverage aspirations through Green Mountain Care.

| Federal Program | Vermont Name | Administering Agency | Key Difference |
|----------------|-------------|---------------------|----------------|
| SNAP | 3SquaresVT | AHS Economic Services Division (ESD) | BBCE: 185% FPL gross income, no asset test (lower than most BBCE states at 200%) |
| Medicaid (MAGI) | Vermont Medicaid (MAGI) | DVHA (Department of Vermont Health Access) | 138% FPL adults; Green Mountain Care universal coverage vision |
| Medicaid (Non-MAGI) | Vermont Medicaid (Non-MAGI) | DVHA | Standard; VT is a 1634 state (SSI auto-enrollment) |
| TANF | Reach Up | DCF (Department for Children and Families) | 60-month federal limit; postsecondary education counts as work activity |
| SSI | SSI | Social Security Administration | Federal program + EAA state supplement (1634 state) |
| WIC | Vermont WIC | VDH (Vermont Department of Health) | Federal rules, VT-administered |
| CHIP | Dr. Dynasaur | DVHA | Children AND pregnant women to 312% FPL (one of most generous in the nation) |
| Section 8 Housing | Section 8 Housing | VHFA and local PHAs | Vermont Housing Finance Agency and local Public Housing Authorities |
| LIHEAP | VT Fuel Assistance | DCF / DCFS | 185% FPL; seasonal fuel assistance (Nov-May heating season) |
| Summer EBT | VT Summer EBT | DCF | Federal rules, VT-administered; CfA Summer EBT technical assistance partnership |

## State-Only Programs

These programs have no federal counterpart. They appear as `add_program` rows in the overlay and have their own program columns (columns 17-19).

### GA — General Assistance
- **Eligibility:** Emergency assistance for individuals and families in crisis
- **Funding:** Town/municipal funding under 33 V.S.A. § 2101
- **Benefit:** Highly variable — administered by towns/municipalities, not the state (unique among states; most use county-based administration)
- **Administration:** Vermont's 246 towns each set their own GA benefit levels and eligibility criteria, creating significant variation across the state
- **Key distinction:** Town-level administration is distinctive among states — most states administer GA at the county or state level

### EA — Emergency Assistance
- **Eligibility:** Families with children facing housing loss or utility disconnection
- **Funding:** State-funded under 33 V.S.A. § 2101
- **Benefit:** Short-term crisis assistance
- **Administration:** Department for Children and Families (DCF)

### EAA — Essential Assistance Allowance
- **Eligibility:** SSI-eligible individuals (aged, blind, or disabled) receiving SSI
- **Funding:** State-funded under 33 V.S.A. § 2501
- **Benefit:** Monthly state supplement to federal SSI payment
- **Administration:** Vermont is a 1634 state — SSA administers federal SSI but EAA is state-administered by AHS

## Key Vermont Policy Differences

### Broad-Based Categorical Eligibility (BBCE) for 3SquaresVT

Vermont uses BBCE, which significantly changes SNAP eligibility:
- **Income threshold:** 185% FPL gross income (vs. federal 130% gross / 100% net)
- **Lower than most BBCE states:** Most states using BBCE set the threshold at 200% FPL; Vermont's 185% threshold is notably lower
- **No asset test:** Asset fields from the federal model are marked `Not Required` for 3SquaresVT
- **No lottery disqualification:** `substantialLotteryWinnings` and `lotteryWinningsAmount` are removed under BBCE
- **ABAWD waivers:** Vermont has historically obtained ABAWD waivers for areas with insufficient jobs
- **Policy basis:** 33 V.S.A. § 2101; ESD Rule 2600

### Dr. Dynasaur — One of the Most Generous CHIP Programs in the Nation

Vermont's Dr. Dynasaur program is a standout among state children's health programs:
- **312% FPL threshold:** Covers children and pregnant women up to 312% FPL, one of the highest CHIP thresholds in the nation
- **Immigration coverage:** Covers lawfully present children and pregnant women regardless of immigration status
- **Green Mountain Care:** Reflects Vermont's broader universal health coverage aspirations. Vermont pursued a single-payer system (Green Mountain Care) under Act 48 (2011), and while the full single-payer implementation was not completed, the aspiration continues to shape Vermont's health policy approach.
- **Policy basis:** 33 V.S.A. § 1901; DVHA rule 4.100

### Vermont Medicaid and the 1634 State Framework

Vermont has a comprehensive health coverage architecture:
- **Expansion adults:** 138% FPL for adults 19-64 under ACA expansion (Vermont Medicaid MAGI)
- **Pregnant women:** 312% FPL through Dr. Dynasaur
- **Children:** 312% FPL through Dr. Dynasaur
- **1634 state:** SSI recipients receive automatic Vermont Medicaid enrollment
- **Medicaid for Working People with Disabilities:** Working disabled buy-in program allowing employed individuals with disabilities to maintain Medicaid coverage
- **60-month look-back:** Vermont uses the federal standard for asset transfers in Medicaid non-MAGI long-term care
- **Policy basis:** 33 V.S.A. § 1901; DVHA rule 4.100

### Reach Up — TANF with Postsecondary Education Pathway

Vermont's Reach Up program has a distinctive approach to work activities:
- **Postsecondary education:** Reach Up allows postsecondary education to count as an eligible work activity, expanding pathways beyond typical TANF work-first approaches. This is significant because most states limit TANF work activities to employment, job search, and vocational training.
- **Federal time limit:** 60-month federal lifetime limit applies
- **Child support:** Good cause exemption includes domestic violence per Family Violence Option
- **Policy basis:** 33 V.S.A. § 1101; Reach Up rule 2200

### VT Fuel Assistance (LIHEAP) Differences

- **Income threshold:** 185% FPL
- **Seasonal:** Primarily covers the heating season (November through May), reflecting Vermont's cold climate and heavy reliance on heating fuel
- **Heating fuels:** Fuel oil and propane are common heating fuels in Vermont, unlike states where natural gas or electricity dominate
- **Crisis component:** Emergency assistance for imminent fuel shortage or utility disconnection during heating season
- **SUA linkage:** VT Fuel Assistance benefit linked to SNAP Standard Utility Allowance (SUA)
- **Administration:** DCFS (Department for Children and Families Services)
- **Policy basis:** 33 V.S.A. § 2601; LIHEAP rule 5700

### SSI/EAA State Supplement

Vermont is a **1634 state**, meaning SSA administers the federal SSI payment, but the Essential Assistance Allowance (EAA) is administered separately by AHS. The `eaaAmount` field captures the state supplement, which provides additional monthly income above the federal SSI payment for aged, blind, and disabled individuals.
- **Policy basis:** 33 V.S.A. § 2501

### Town-Administered General Assistance

Vermont's General Assistance program is distinctive because it is **administered by towns/municipalities** rather than counties or the state:
- Vermont's 246 towns each set their own GA benefit levels and eligibility criteria
- This creates significant variation in benefit availability across the state
- Most other states administer GA at the county or state level
- **Policy basis:** 33 V.S.A. § 2101

## District Office Administration

Vermont uses **12 district offices** rather than county-based administration. This is a structural difference from most states (e.g., Minnesota's 87 counties, California's 58 counties). The `districtOfficeCode` field identifies which AHS field office administers the case.

## ACCESS Vermont System

ACCESS Vermont is the state's integrated eligibility system for benefits administration. The overlay adds two system fields:
- `accessCaseNumber` on Application — case tracking number in the ACCESS system
- `accessClientId` on Person — client identifier used across all state-administered programs

## Vermont Regulatory Citation Guide

The overlay uses several citation formats:

| Format | Source | Example |
|--------|--------|---------|
| **V.S.A. §** | Vermont Statutes Annotated | 33 V.S.A. § 2101 |
| **ESD Rule** | Economic Services Division rules | ESD Rule 2600 |
| **DVHA rule** | Department of Vermont Health Access rules | DVHA rule 4.100 |
| **Reach Up rule** | Reach Up program rules | Reach Up rule 2200 |
| **LIHEAP rule** | LIHEAP program rules | LIHEAP rule 5700 |
| **AHS rule** | Agency of Human Services rules | AHS rule |

Key regulatory sources:
- **33 V.S.A. § 1901** — Vermont Medicaid / Dr. Dynasaur statutes
- **33 V.S.A. § 1101** — Reach Up (TANF) statutes
- **33 V.S.A. § 2101** — General Assistance and Emergency Assistance statutes
- **33 V.S.A. § 2501** — Essential Assistance Allowance (EAA) statutes
- **33 V.S.A. § 2601** — Fuel Assistance (LIHEAP) statutes
- **33 V.S.A. § 101** — Agency of Human Services general provisions
- **1 V.S.A. § 317** — Language access requirements
- **ESD Rule 2600** — Economic Services Division 3SquaresVT rules
- **DVHA rule 4.100** — Department of Vermont Health Access Medicaid rules

## Vermont-Specific System Fields

The overlay adds four system fields used across Vermont programs:

| Field | Entity | Purpose |
|-------|--------|---------|
| `districtOfficeCode` | Household | Identifies which of the 12 district offices administers the case |
| `accessCaseNumber` | Application | ACCESS Vermont system case tracking number |
| `vermontResidencyVerified` | Household | Confirms Vermont residency for state-administered programs |
| `accessClientId` | Person | ACCESS Vermont system client identifier |

## CfA Partnership Context

Vermont is the smallest population CfA partner state. The CfA Summer EBT technical assistance partnership supports VT Summer EBT implementation. Vermont's small size and integrated systems (ACCESS Vermont) create opportunities for streamlined benefits delivery that may not scale the same way in larger states.

## Confidence and SME Review

This overlay represents a **first draft** compiled from publicly available Vermont statutes, rules, and policy documents. It should be reviewed by Vermont-specific subject matter experts before use in production systems.

Areas that particularly benefit from SME review:
- Dr. Dynasaur eligibility boundaries (312% FPL threshold verification, immigration coverage scope, interaction with Vermont Medicaid MAGI)
- Reach Up postsecondary education provisions (which degree programs qualify, hour requirements, duration limits)
- GA town-level variation (how benefit levels differ across Vermont's 246 towns, whether state provides minimum standards)
- EAA benefit levels (current monthly supplement amounts, eligibility interaction with federal SSI)
- Fuel assistance seasonal details (exact heating season dates, crisis assistance availability outside primary season, fuel type differentials)
- 3SquaresVT BBCE threshold confirmation (185% FPL versus other BBCE states)
- ABAWD waiver status (current waiver geography and expiration dates)
- Medicaid for Working People with Disabilities income limits and employment verification requirements
- ACCESS Vermont system integration and case number formats
- 12 district office boundaries and any district-specific policy variation
- Green Mountain Care / universal coverage policy evolution and current status

## Future State Overlays

Additional states follow the same pattern in this directory:
- `{state}-benefits-overlay.csv` — State overlay CSV
- `{state}-benefits-overlay-guide.md` — Companion guide

Each state overlay uses the same column structure and OverlayAction semantics, with the number of columns varying by state based on the number of state-only programs.
