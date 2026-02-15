# Louisiana Benefits Overlay Guide

This guide explains how to read and use the [Louisiana Benefits Overlay CSV](louisiana-benefits-overlay.csv) alongside the [Federal Benefits Data Model](../federal-benefits-data-model.csv).

## How to Read the Overlay

The overlay CSV contains **only differences** from the federal baseline. It does not repeat unchanged fields.

### OverlayAction Values

| Action | Meaning |
|--------|---------|
| `update` | Modifies an existing federal field. Blank cells mean "same as federal" — only populated cells represent Louisiana-specific differences. |
| `remove` | Louisiana does not collect this field. The field exists in the federal model but is not used in Louisiana's implementation. |
| `add` | A new Louisiana-only field not present in the federal model. The Entity must exist in the federal model (e.g., Person, Household). |
| `add_program` | Introduces a state-only program with no federal counterpart. The program column (CCAP or KCSP) is marked `Program`. |

### Blank Cell Rule

For `update` rows, **blank = same as federal**. Only cells that differ from the federal model are populated. This keeps the overlay compact and makes differences immediately visible.

### How to Cross-Reference

1. Open both the federal CSV and the Louisiana overlay CSV
2. For each overlay row, find the matching **Entity + Field** pair in the federal CSV
3. Any populated cell in the overlay overrides the corresponding federal value
4. Any blank cell in the overlay means the federal value applies unchanged

## Louisiana Program Mapping

Louisiana implements all 10 federal programs. Louisiana is notable as a **non-BBCE state** for SNAP, has one of the nation's shortest TANF time limits (24 months), and uses **parishes** (not counties) as its local administrative unit. Louisiana has a relatively thin state safety net with only 2 state-only programs.

| Federal Program | Louisiana Name | Administering Agency | Key Difference |
|----------------|----------------|---------------------|----------------|
| SNAP | LA SNAP | Parish DCFS offices via CAFE | **No BBCE** — standard federal rules: 130% FPL gross / 100% net, asset test ($2,750/$4,250 elderly-disabled) |
| Medicaid (MAGI) | Healthy Louisiana (MAGI) | Louisiana Department of Health (LDH) via managed care organizations (MCOs) | 138% FPL adults, 138% FPL pregnant, 217% FPL children; expanded July 2016 |
| Medicaid (Non-MAGI) | Medicaid (Non-MAGI) | Louisiana Department of Health (LDH) | Standard; LA is a 1634 state; Medicaid Buy-In for workers with disabilities |
| TANF | FITAP (Family Independence Temporary Assistance Program) | Parish DCFS offices via CAFE | **24-month state time limit** within any 60-month period — one of the shortest in the nation |
| SSI | SSI | Social Security Administration | Federal program; **no state supplement** (Louisiana does NOT provide optional state SSI supplement) |
| WIC | Louisiana WIC | Louisiana Department of Health, local agencies | Federal rules, LA-administered |
| CHIP | LaCHIP | Louisiana Department of Health (LDH) | Separate CHIP program; children up to 212% FPL |
| Section 8 Housing | Section 8 Housing | Local Public Housing Authorities | Administered by local PHAs |
| LIHEAP | LA LIHEAP | Louisiana Housing Corporation / community action agencies | 60% SMI; **primarily cooling-focused** given subtropical climate; crisis component |
| Summer EBT | LA Summer EBT | Louisiana DCFS | Federal rules, LA-administered |

## State-Only Programs

Louisiana has **2 state-only programs** — a thinner state safety net compared to states like Minnesota (3) or California (4). These programs have no federal counterpart. They appear as `add_program` rows in the overlay and have their own program columns (columns 17-18).

### CCAP — Child Care Assistance Program
- **Eligibility:** Working families, families in education/training, or families participating in FITAP work activities
- **Funding:** State and federal child care funds under La. R.S. 46:1401; LAC 67:III.Chapter 51
- **Benefit:** Subsidized child care; income limits based on state median income
- **Administration:** Louisiana Department of Education
- **Age limits:** Children under 13 (or under 18 with special needs)

### KCSP — Kinship Care Subsidy Program
- **Eligibility:** Relative caregivers of children who might otherwise be in foster care; caregiver must be related within the fifth degree of kinship per Louisiana Civil Code
- **Funding:** State-funded under La. R.S. 46:286; LAC 67:V.4901
- **Benefit:** Monthly subsidy payments to relative caregivers
- **Administration:** Louisiana DCFS (Department of Children and Family Services)

## Key Louisiana Policy Differences

### No Broad-Based Categorical Eligibility (BBCE) for SNAP

**Louisiana does NOT use BBCE.** This is the single most significant structural difference from BBCE states like California, Colorado, and Minnesota. The practical impacts are:

- **Gross income test:** 130% FPL (vs. 200% FPL in many BBCE states)
- **Net income test:** 100% FPL (BBCE states eliminate this test)
- **Asset test applies:** $2,750 standard / $4,250 for households with elderly or disabled member (BBCE states eliminate asset testing)
- **Lottery/gambling disqualification remains:** Unlike BBCE states, Louisiana retains categorical ineligibility for substantial lottery/gambling winnings
- **No overlay rows removing asset fields:** Unlike CA/CO/MN overlays, the Louisiana overlay does not contain `remove` rows for SNAP asset fields or lottery fields, because these federal requirements remain in effect
- **Policy basis:** La. R.S. 46:231; LAC 67:III.Chapter 19

### FITAP — One of the Nation's Shortest Time Limits

Louisiana's TANF program (FITAP) has exceptionally restrictive time limits:
- **State time limit:** 24 months of cash assistance within any 60-month period — one of the shortest in the nation
- **Federal time limit:** 60-month lifetime limit also applies
- **Hardship extensions:** Available for up to 10% of the caseload
- **Diversion payment:** One-time lump-sum payment available as an alternative to ongoing FITAP enrollment
- **Child support cooperation:** Required, with good cause exemption for domestic violence per Family Violence Option
- **Policy basis:** La. R.S. 46:231.2; LAC 67:III.5543

### Healthy Louisiana and Medicaid Expansion

Louisiana expanded Medicaid under the ACA effective July 2016:
- **Expansion adults:** 138% FPL for adults 19-64 (Healthy Louisiana MAGI)
- **Pregnant women:** 138% FPL through Healthy Louisiana
- **Children:** 217% FPL through Healthy Louisiana
- **LaCHIP:** Separate CHIP program for children up to 212% FPL
- **Managed care:** Healthy Louisiana is delivered through managed care organizations (MCOs)
- **Immigration coverage:** Lawfully present non-citizens covered after 5-year bar; emergency Medicaid available regardless of immigration status
- **1634 state:** SSI recipients receive automatic Medicaid enrollment
- **Medicaid Buy-In:** Working individuals with disabilities may qualify for Medicaid with income up to 250% FPL (La. R.S. 46:979)

### Medicaid Non-MAGI (Long-Term Care / Aged / Disabled)

- **Asset limits:** Standard federal limits apply
- **Look-back period:** 60 months (federal standard)
- **Transfer penalty:** Divisor based on average private-pay nursing facility rate
- **Policy basis:** La. R.S. 46:977.3; LAC 50:III.10157

### SSI — No State Supplement

Louisiana does **NOT** provide an optional state SSI supplement. This is a significant difference from states like Minnesota (which provides MSA) and California (which provides SSP). SSI recipients in Louisiana receive only the federal SSI payment amount. Louisiana is a 1634 state for Medicaid purposes — SSI recipients receive automatic Medicaid enrollment — but there is no additional state cash supplement.

### LA LIHEAP — Cooling-Focused

Louisiana's LIHEAP program reflects the state's subtropical climate:
- **Income threshold:** 60% of state median income
- **Primary benefit:** Summer cooling assistance (unlike northern states where heating is primary)
- **Crisis component:** Emergency assistance for utility emergencies, available year-round
- **Administration:** Louisiana Housing Corporation and community action agencies
- **Policy basis:** La. R.S. 40:2151; LAC 67:VII.301

### Parish Administration and the CAFE System

Louisiana uses **64 parishes** (not counties) as its local administrative unit. Benefits are administered through the CAFE (Common Access Front End) integrated eligibility system:
- **CAFE:** Single integrated eligibility system for SNAP, Medicaid, FITAP, LIHEAP, and other programs
- The `parishCode` field identifies the administering parish office
- `cafeCaseNumber` tracks cases across programs
- `cafeClientId` identifies clients in the CAFE system
- **DCFS:** Louisiana Department of Children and Family Services administers cash and food assistance programs
- **LDH:** Louisiana Department of Health administers Medicaid and health programs

## Louisiana Regulatory Citation Guide

The overlay uses two citation formats:

| Format | Source | Example |
|--------|--------|---------|
| **La. R.S.** | Louisiana Revised Statutes | La. R.S. 46:231 |
| **LAC** | Louisiana Administrative Code | LAC 67:III.5543 |

Key regulatory sources:
- **La. R.S. 46:231** — SNAP and public assistance statutes
- **La. R.S. 46:977** — Medicaid statutes
- **La. R.S. 46:979** — Medicaid Buy-In program
- **La. R.S. 46:1401** — Child Care Assistance Program (CCAP)
- **La. R.S. 46:286** — Kinship Care Subsidy Program (KCSP)
- **La. R.S. 40:2151** — LIHEAP statutes
- **La. R.S. 46:236.1** — Child support enforcement
- **LAC 67:III** — DCFS rules for cash and food assistance programs
- **LAC 50:III** — Louisiana Department of Health Medicaid rules
- **LAC 67:VII** — LIHEAP rules
- **LAC 67:V** — Child welfare rules (including KCSP)

## Louisiana-Specific System Fields

The overlay adds four system fields used across Louisiana programs:

| Field | Entity | Purpose |
|-------|--------|---------|
| `parishCode` | Household | Identifies which of the 64 parishes administers the case |
| `cafeCaseNumber` | Application | CAFE integrated eligibility system case tracking number |
| `louisianaResidencyVerified` | Household | Confirms Louisiana residency for state-administered programs |
| `cafeClientId` | Person | CAFE eligibility system client identifier |

## Confidence and SME Review

This overlay represents a **first draft** compiled from publicly available Louisiana statutes, administrative code, and policy documents. It should be reviewed by Louisiana-specific subject matter experts before use in production systems.

Areas that particularly benefit from SME review:
- FITAP participation rates and actual diversion payment utilization
- LaCHIP income thresholds and enrollment mechanics (212% vs 217% FPL boundary)
- CCAP income limits relative to state median income and sliding fee scale details
- KCSP eligibility criteria beyond kinship degree (background check requirements, home assessment)
- CAFE system details (case number formats, integration between DCFS and LDH systems)
- Healthy Louisiana managed care organization (MCO) enrollment process
- Medicaid Buy-In income verification and employment requirements
- LA LIHEAP cooling assistance benefit calculation methodology
- ABAWD waiver status by parish (which parishes currently have waivers)
- LaCHIP vs Healthy Louisiana boundary for children at different income levels

## Future State Overlays

Additional states follow the same pattern in this directory:
- `{state}-benefits-overlay.csv` — State overlay CSV
- `{state}-benefits-overlay-guide.md` — Companion guide

Each state overlay uses the same column structure and OverlayAction semantics, with the number of columns varying by state based on the number of state-only programs.
