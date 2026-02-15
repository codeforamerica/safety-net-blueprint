# Michigan Benefits Overlay Guide

This guide explains how to read and use the [Michigan Benefits Overlay CSV](michigan-benefits-overlay.csv) alongside the [Federal Benefits Data Model](../federal-benefits-data-model.csv).

## How to Read the Overlay

The overlay CSV contains **only differences** from the federal baseline. It does not repeat unchanged fields.

### OverlayAction Values

| Action | Meaning |
|--------|---------|
| `update` | Modifies an existing federal field. Blank cells mean "same as federal" — only populated cells represent Michigan-specific differences. |
| `remove` | Michigan does not collect this field. The field exists in the federal model but is not used in Michigan's implementation. |
| `add` | A new Michigan-only field not present in the federal model. The Entity must exist in the federal model (e.g., Person, Household). |
| `add_program` | Introduces a state-only program with no federal counterpart. The program column (SDA, SER, or CDC) is marked `Program`. |

### Blank Cell Rule

For `update` rows, **blank = same as federal**. Only cells that differ from the federal model are populated. This keeps the overlay compact and makes differences immediately visible.

### How to Cross-Reference

1. Open both the federal CSV and the Michigan overlay CSV
2. For each overlay row, find the matching **Entity + Field** pair in the federal CSV
3. Any populated cell in the overlay overrides the corresponding federal value
4. Any blank cell in the overlay means the federal value applies unchanged

## Michigan Program Mapping

Michigan implements all 10 federal programs, several under distinctive state names. Michigan's policy architecture includes notable structural differences — the Healthy Michigan Plan adds a healthy behaviors incentive unique among Medicaid expansion states, and FIP imposes a 48-month state time limit shorter than the 60-month federal standard.

| Federal Program | Michigan Name | Administering Agency | Key Difference |
|----------------|---------------|---------------------|----------------|
| SNAP | MI SNAP | MDHHS via Bridges | BBCE: 200% FPL gross income, no asset test |
| Medicaid (MAGI) | Healthy Michigan Plan | MDHHS via Bridges | 138% FPL adults, healthy behaviors incentive (copay reduction for health risk assessment) |
| Medicaid (Non-MAGI) | Medicaid (Non-MAGI) | MDHHS via Bridges | Standard federal rules, MI is 1634 state |
| TANF | FIP (Family Independence Program) | MDHHS via Bridges | 48-month state time limit (shorter than 60-month federal) |
| SSI | SSI | Social Security Administration | Federal program + small state supplement (1634 state) |
| WIC | Michigan WIC | MDHHS, local agencies | Federal rules, MI-administered |
| CHIP | MIChild | MDHHS | Children in families 200-217% FPL |
| Section 8 Housing | Section 8 Housing | Local Public Housing Authorities | Administered by local PHAs |
| LIHEAP | Michigan LIHEAP | MDHHS | 150% FPL or 110% SMI, winter heating focus |
| Summer EBT | MI Summer EBT | MDHHS | Federal rules, MI-administered |

## State-Only Programs

These programs have no federal counterpart. They appear as `add_program` rows in the overlay and have their own program columns (columns 17-19).

### SDA — State Disability Assistance
- **Eligibility:** Disabled adults who are not eligible for SSI
- **Funding:** State-funded under MCL 400.10a
- **Benefit:** Cash assistance of approximately $200/month
- **Administration:** MDHHS (Michigan Department of Health and Human Services)

### SER — State Emergency Relief
- **Eligibility:** Individuals and families facing an emergency (heat shutoff, eviction, homelessness, burial costs)
- **Funding:** State-funded under MCL 400.10
- **Benefit:** Crisis payments for heat, utilities, housing, and burial
- **Administration:** MDHHS

### CDC — Child Development and Care
- **Eligibility:** Working families with low income who need child care to maintain employment or participate in approved activities
- **Funding:** State-funded under MCL 400.14a
- **Benefit:** Subsidized child care payments to providers
- **Administration:** MDHHS

## Key Michigan Policy Differences

### Broad-Based Categorical Eligibility (BBCE) for SNAP

Michigan uses BBCE, which significantly changes SNAP eligibility:
- **Income threshold:** 200% FPL gross income (vs. federal 130% gross / 100% net)
- **No asset test:** Asset fields from the federal model are marked `Not Required` for MI SNAP
- **No lottery disqualification:** `substantialLotteryWinnings` and `lotteryWinningsAmount` are removed under BBCE
- **Policy basis:** MCL 400.55; Mich. Admin. Code R 400.3001

### Healthy Michigan Plan

Michigan's Medicaid expansion program with distinctive features:
- **Expansion adults:** 138% FPL for adults 19-64 under ACA expansion
- **Pregnant women:** 195% FPL through Medicaid
- **Children:** 200-217% FPL through MIChild (Michigan's CHIP program)
- **Healthy behaviors incentive:** Enrollees who complete a health risk assessment receive reduced copay obligations. The `healthyBehaviorsCompleted` field tracks this incentive.
- **Immigration coverage:** Healthy Michigan Plan covers lawfully present immigrants after the 5-year bar; MIChild covers lawfully present children
- **1634 state:** SSI recipients receive automatic Medicaid enrollment
- **Medicaid Buy-In:** Workers with disabilities may qualify for the Medicaid Buy-In program
- **Policy basis:** MCL 400.105; MCL 400.106

### Medicaid Non-MAGI (Long-Term Care / Aged / Disabled)

- **Asset transfers:** 60-month look-back period (standard federal rule)
- **Resource limits:** Standard SSI-methodology resource limits apply
- **1634 state:** MI follows the SSI standard for automatic Medicaid eligibility

### FIP — Family Independence Program

Michigan's TANF program with a notably shorter time limit:
- **State time limit:** 48-month state lifetime limit (shorter than the 60-month federal limit)
- **Sanctions:** Escalating sanction system — first sanction reduces grant 25%; subsequent sanctions increase. Tracked via `fipSanctionLevel`.
- **Child support:** Good cause exemption includes domestic violence per Family Violence Option
- **Policy basis:** MCL 400.57; Mich. Admin. Code R 400.3100

### Michigan LIHEAP

- **Income threshold:** 150% FPL or 110% of state median income
- **Winter focus:** Primary emphasis on winter heating assistance
- **SUA linkage:** Michigan LIHEAP benefit confers SNAP Standard Utility Allowance (SUA) eligibility
- **Administration:** MDHHS (unlike Minnesota where community action agencies administer)
- **Policy basis:** MCL 400.1201

### SSI State Supplement

Michigan is a **1634 state**, meaning SSA administers the federal SSI payment. Michigan provides a small state supplement captured in the `miStateSupplementAmount` field. Policy basis: MCL 400.10a.

### County Administration

Michigan's 83 counties each administer benefits programs through MDHHS county offices:
- **Bridges:** The statewide eligibility system for all MDHHS-administered programs
- **MiBridges:** The online self-service portal for applications and case management
- The `countyCode` field identifies the administering county office
- `bridgesCaseNumber` tracks cases in the Bridges system
- `bridgesClientId` identifies clients across all MDHHS programs
- **ABAWD waivers:** County-specific ABAWD time-limit waivers available in qualifying areas

## Michigan Regulatory Citation Guide

The overlay uses two citation formats:

| Format | Source | Example |
|--------|--------|---------|
| **MCL** | Michigan Compiled Laws | MCL 400.55 |
| **Mich. Admin. Code R** | Michigan Administrative Code (administrative rules) | Mich. Admin. Code R 400.3001 |

Key regulatory sources:
- **MCL 400.1** — Michigan social welfare act (general provisions)
- **MCL 400.10** — State Emergency Relief
- **MCL 400.10a** — State Disability Assistance; SSI state supplement
- **MCL 400.14a** — Child Development and Care
- **MCL 400.55** — SNAP/food assistance provisions
- **MCL 400.57** — FIP/TANF provisions
- **MCL 400.105** — Medicaid/Healthy Michigan Plan
- **MCL 400.106** — MIChild
- **MCL 400.1201** — Michigan LIHEAP
- **MCL 408.1011** — Language access requirements
- **Mich. Admin. Code R 400** — MDHHS administrative rules (general)
- **Mich. Admin. Code R 400.3001** — SNAP eligibility rules
- **Mich. Admin. Code R 400.3100** — FIP eligibility rules

## Michigan-Specific System Fields

The overlay adds four system fields used across Michigan programs:

| Field | Entity | Purpose |
|-------|--------|---------|
| `countyCode` | Household | Identifies which of the 83 county MDHHS offices administers the case |
| `bridgesCaseNumber` | Application | Bridges/MiBridges case tracking number |
| `michiganResidencyVerified` | Household | Confirms Michigan residency for state-administered programs |
| `bridgesClientId` | Person | Bridges eligibility system client identifier |

## Confidence and SME Review

This overlay represents a **first draft** compiled from publicly available Michigan statutes, administrative code, and policy documents. It should be reviewed by Michigan-specific subject matter experts before use in production systems.

Areas that particularly benefit from SME review:
- Civilla/MiBridges alignment — ensuring field names and data flow match the current MiBridges application
- Healthy Michigan Plan healthy behaviors details — copay reduction mechanics, health risk assessment timing, and reporting
- FIP 48-month time limit specifics — extension criteria, hardship exemptions, and interaction with federal 60-month limit
- SDA eligibility criteria and current benefit amounts (approximately $200/month but subject to change)
- SER crisis categories, maximum benefit amounts, and frequency limits
- CDC income thresholds, copay schedules, and provider payment rates
- Michigan LIHEAP benefit calculation methodology and seasonal timing
- SSI state supplement current amounts and eligibility criteria
- Bridges/MiBridges system integration and case number formats
- County-level variation in program administration and ABAWD waiver status
- MIChild enrollment process and coordination with Healthy Michigan Plan

## Future State Overlays

Additional states follow the same pattern in this directory:
- `{state}-benefits-overlay.csv` — State overlay CSV
- `{state}-benefits-overlay-guide.md` — Companion guide

Each state overlay uses the same column structure and OverlayAction semantics, with the number of columns varying by state based on the number of state-only programs.
