# Colorado Benefits Overlay Guide

This guide explains how to read and use the [Colorado Benefits Overlay CSV](colorado-benefits-overlay.csv) alongside the [Federal Benefits Data Model](../federal-benefits-data-model.csv).

## How to Read the Overlay

The overlay CSV contains **only differences** from the federal baseline. It does not repeat unchanged fields.

### OverlayAction Values

| Action | Meaning |
|--------|---------|
| `update` | Modifies an existing federal field. Blank cells mean "same as federal" — only populated cells represent Colorado-specific differences. |
| `remove` | Colorado does not collect this field. The field exists in the federal model but is not used in Colorado's implementation. |
| `add` | A new Colorado-only field not present in the federal model. The Entity must exist in the federal model (e.g., Person, Household). |
| `add_program` | Introduces a state-only program with no federal counterpart. The program column (OAP, AND, AB, or CCCAP) is marked `Program`. |

### Blank Cell Rule

For `update` rows, **blank = same as federal**. Only cells that differ from the federal model are populated. This keeps the overlay compact and makes differences immediately visible.

### How to Cross-Reference

1. Open both the federal CSV and the Colorado overlay CSV
2. For each overlay row, find the matching **Entity + Field** pair in the federal CSV
3. Any populated cell in the overlay overrides the corresponding federal value
4. Any blank cell in the overlay means the federal value applies unchanged

## Colorado Program Mapping

Colorado implements all 10 federal programs, often under state-specific names and with different administering agencies.

| Federal Program | Colorado Name | Administering Agency | Key Difference |
|----------------|---------------|---------------------|----------------|
| SNAP | CO SNAP | County Departments of Human/Social Services | BBCE: 200% FPL gross income, no asset test |
| Medicaid (MAGI) | Health First Colorado (MAGI) | County DHS via CBMS | ACA expansion, 138% FPL adults, 260% FPL pregnant |
| Medicaid (Non-MAGI) | Health First Colorado (Non-MAGI) | County DHS via CBMS | Buy-In for Working Adults with Disabilities |
| TANF | Colorado Works | County DHS (64 counties with local flexibility) | County-administered, 60-month lifetime limit with county extensions |
| SSI | SSI | Social Security Administration | Federal program + CO mandatory state supplement (1634 state) |
| WIC | Colorado WIC | CDPHE (CO Dept of Public Health and Environment) | Federal rules, CO-administered |
| CHIP | CHP+ (Child Health Plan Plus) | HCPF (Dept of Health Care Policy and Financing) | 260% FPL, CHP+ Prenatal covers regardless of immigration status |
| Section 8 Housing | Section 8 Housing | Local Public Housing Authorities | Administered by local PHAs, not county offices |
| LIHEAP | LEAP (Low-Income Energy Assistance Program) | CDHS (CO Dept of Human Services) | 60% state median income or 185% FPL, Nov 1 – Apr 30 |
| Summer EBT | Colorado Summer EBT | CDHS | Federal rules, CO-administered |

## State-Only Programs

These programs have no federal counterpart. They appear as `add_program` rows in the overlay and have their own program columns (columns 18–21).

### OAP — Old Age Pension
- **Eligibility:** Colorado residents age 60+ who do not qualify for SSI
- **Funding:** State-funded under C.R.S. § 26-2-111 through 26-2-119
- **Benefit:** Monthly cash assistance up to the OAP standard
- **Administration:** County Departments of Human/Social Services

### AND — Aid to the Needy Disabled
- **Eligibility:** Disabled adults who are pending SSI determination or ineligible for SSI
- **Funding:** State-funded under C.R.S. § 26-2-111 through 26-2-119
- **Benefit:** Monthly cash assistance while awaiting SSI or as an alternative
- **Administration:** County Departments of Human/Social Services

### AB — Aid to the Blind
- **Eligibility:** Blind individuals (meeting SSA blindness definition) who do not qualify for SSI
- **Funding:** State-funded under C.R.S. § 26-2-111 through 26-2-119
- **Benefit:** Monthly cash assistance
- **Administration:** County Departments of Human/Social Services

### CCCAP — Colorado Child Care Assistance Program
- **Eligibility:** Low-income working families (at or below 185% FPL for initial eligibility)
- **Funding:** Federal CCDF block grant + state funds, C.R.S. § 26-2-803 through 26-2-810
- **Benefit:** Subsidized child care through licensed centers, family child care homes, or license-exempt providers
- **Administration:** County Departments of Human/Social Services

## Key Colorado Policy Differences

### Broad-Based Categorical Eligibility (BBCE) for SNAP

Colorado uses BBCE, which significantly changes SNAP eligibility:
- **Income threshold:** 200% FPL gross income (vs. federal 130% gross / 100% net)
- **No asset test:** Asset fields from the federal model are marked `Not Required` for CO SNAP
- **No lottery disqualification:** `substantialLotteryWinnings` and `lotteryWinningsAmount` are removed under BBCE
- **Policy basis:** 10 CCR 2506-1, Section 4.603

### Health First Colorado (Medicaid) and ACA Expansion

- **Expansion adults:** 138% FPL for adults 19–64 under ACA expansion
- **Pregnant women:** 260% FPL through Health First Colorado and CHP+ Prenatal
- **Children:** 142% FPL for children under 19
- **CHP+ Prenatal:** Covers pregnant women regardless of immigration status up to 260% FPL
- **Buy-In Program:** Working adults with disabilities can maintain Medicaid coverage (C.R.S. § 25.5-6-202)
- **1634 state:** SSI recipients receive automatic Health First Colorado enrollment

### County Administration

Colorado's 64 counties each administer benefits programs with local flexibility:
- The `countyOfficeCode` field (added in the overlay) identifies the administering county
- Colorado Works (TANF) counties may grant time-limit extensions beyond the 60-month federal limit
- ABAWD time-limit waivers are available in qualifying county areas
- County offices are the primary point of contact for CO SNAP, Health First Colorado, Colorado Works, LEAP, OAP, AND, and AB

### LEAP (LIHEAP) Differences

- **Income threshold:** 60% of state median income or 185% FPL, whichever is higher
- **Heating season:** November 1 through April 30 only (not year-round)
- **Heat/eat:** A minimal LEAP benefit confers SNAP Standard Utility Allowance (SUA) eligibility
- **Policy basis:** C.R.S. § 40-8.7-104; 10 CCR 2507-1

### SSI State Supplement

Colorado is a **1634 state**, meaning the Social Security Administration administers the state supplement alongside the federal SSI payment. The `coStateSupplementAmount` field captures the Colorado-specific supplement amount, which varies by living arrangement.

## Colorado Regulatory Citation Guide

The overlay uses two citation formats:

| Format | Source | Example |
|--------|--------|---------|
| **C.R.S. §** | Colorado Revised Statutes | C.R.S. § 26-2-111 |
| **10 CCR** | Code of Colorado Regulations | 10 CCR 2506-1 § 4.603 |

Key regulatory volumes:
- **10 CCR 2506-1** — Rules for public assistance programs (SNAP, Colorado Works, OAP, AND, AB)
- **10 CCR 2507-1** — LEAP rules
- **C.R.S. Title 25.5** — Health First Colorado and CHP+ statutes
- **C.R.S. Title 26** — Human services statutes (TANF, OAP, AND, AB, CCCAP)

## Colorado-Specific System Fields

The overlay adds four system fields used across Colorado programs:

| Field | Entity | Purpose |
|-------|--------|---------|
| `countyOfficeCode` | Household | Identifies which of the 64 county offices administers the case |
| `peakConfirmationNumber` | Application | Tracking number from PEAK (online portal) or CBMS |
| `coloradoResidencyVerified` | Household | Confirms Colorado residency for state-administered programs |
| `cbmsClientId` | Person | Colorado Benefits Management System client identifier |

## Confidence and SME Review

This overlay represents a **first draft** compiled from publicly available Colorado statutes, regulations, and policy documents. It should be reviewed by Colorado-specific subject matter experts before use in production systems.

Areas that particularly benefit from SME review:
- BBCE income threshold details and interaction with categorical eligibility
- CHP+ Prenatal immigration status coverage specifics
- County-level variation in Colorado Works time-limit extensions
- OAP/AND/AB income standards and eligibility criteria (state-specific, less publicly documented)
- CCCAP copayment schedules and provider type requirements
- LEAP heat/eat interaction with SNAP SUA calculations

## Future State Overlays

Additional states follow the same pattern in this directory:
- `{state}-benefits-overlay.csv` — State overlay CSV
- `{state}-benefits-overlay-guide.md` — Companion guide

Each state overlay uses the same 25-column structure and OverlayAction semantics.
