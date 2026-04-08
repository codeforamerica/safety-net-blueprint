# Minnesota Benefits Overlay Guide

This guide explains how to read and use the [Minnesota Benefits Overlay CSV](minnesota-benefits-overlay.csv) alongside the [Federal Benefits Data Model](../federal-benefits-data-model.csv).

## How to Read the Overlay

The overlay CSV contains **only differences** from the federal baseline. It does not repeat unchanged fields.

### OverlayAction Values

| Action | Meaning |
|--------|---------|
| `update` | Modifies an existing federal field. Blank cells mean "same as federal" — only populated cells represent Minnesota-specific differences. |
| `remove` | Minnesota does not collect this field. The field exists in the federal model but is not used in Minnesota's implementation. |
| `add` | A new Minnesota-only field not present in the federal model. The Entity must exist in the federal model (e.g., Person, Household). |
| `add_program` | Introduces a state-only program with no federal counterpart. The program column (MSA, GA, or EA) is marked `Program`. |

### Blank Cell Rule

For `update` rows, **blank = same as federal**. Only cells that differ from the federal model are populated. This keeps the overlay compact and makes differences immediately visible.

### How to Cross-Reference

1. Open both the federal CSV and the Minnesota overlay CSV
2. For each overlay row, find the matching **Entity + Field** pair in the federal CSV
3. Any populated cell in the overlay overrides the corresponding federal value
4. Any blank cell in the overlay means the federal value applies unchanged

## Minnesota Program Mapping

Minnesota implements all 10 federal programs, several under distinctive state names. Minnesota's policy architecture includes notable structural differences — MFIP combines cash and food assistance in a single grant (unique among states), and MinnesotaCare extends beyond CHIP to cover adults.

| Federal Program | Minnesota Name | Administering Agency | Key Difference |
|----------------|----------------|---------------------|----------------|
| SNAP | MN SNAP | County human services agencies via MAXIS | BBCE: 200% FPL gross income, no asset test. People on MFIP do not receive separate SNAP. |
| Medicaid (MAGI) | Medical Assistance (MAGI) | County agencies via METS / DHS | 138% FPL adults, 275% FPL children, 278% FPL pregnant women |
| Medicaid (Non-MAGI) | Medical Assistance (Non-MAGI) | County agencies via METS / DHS | MA-EPD working disabled buy-in, TEFRA children, aggressive MERP estate recovery |
| TANF | MFIP (Minnesota Family Investment Program) | County agencies via MAXIS / DHS | **Combined cash + food grant** (unique among states); DWP 4-month diversion |
| SSI | SSI | Social Security Administration | Federal program + MSA state supplement (1634 state) |
| WIC | Minnesota WIC | MDH (MN Dept of Health), local agencies | Federal rules, MN-administered |
| CHIP | MinnesotaCare | DHS (Dept of Human Services) | Broader than CHIP: covers adults to 200% FPL; children to 275% FPL |
| Section 8 Housing | Section 8 Housing | Local Public Housing Authorities | Administered by local PHAs |
| LIHEAP | EAP (Energy Assistance Program) | Community action agencies + tribal nations | 50% SMI, year-round, crisis component |
| Summer EBT | MN Summer EBT | DHS | Federal rules, MN-administered |

## State-Only Programs

These programs have no federal counterpart. They appear as `add_program` rows in the overlay and have their own program columns (columns 18–20).

### MSA — Minnesota Supplemental Aid
- **Eligibility:** SSI-eligible individuals (aged, blind, or disabled) receiving SSI
- **Funding:** State-funded under Minn. Stat. § 256D.35–.46
- **Benefit:** Monthly state supplement to SSI; includes housing assistance supplement and special diet supplement
- **Administration:** County human services agencies (MN is a 1634 state — SSA administers federal SSI but MSA is state-administered)

### GA — General Assistance
- **Eligibility:** Single adults without children who are not eligible for MFIP or SSI; last-resort cash assistance
- **Funding:** State-funded under Minn. Stat. § 256D.01–.21
- **Benefit:** $203/month maximum
- **Administration:** County human services agencies

### EA — Emergency Assistance
- **Eligibility:** Families with children facing housing loss or utility disconnection
- **Funding:** State-funded under Minn. Stat. § 256J.48
- **Benefit:** Short-term crisis assistance; 30-day maximum per episode
- **Administration:** County human services agencies

## Key Minnesota Policy Differences

### Broad-Based Categorical Eligibility (BBCE) for SNAP

Minnesota uses BBCE, which significantly changes SNAP eligibility:
- **Income threshold:** 200% FPL gross income (vs. federal 130% gross / 100% net)
- **No asset test:** Asset fields from the federal model are marked `Not Required` for MN SNAP
- **No lottery disqualification:** `substantialLotteryWinnings` and `lotteryWinningsAmount` are removed under BBCE
- **MFIP interaction:** People receiving MFIP do not receive separate SNAP — the food portion is built into the MFIP grant
- **Policy basis:** Minn. Stat. § 256D.02; Minn. R. 9505.0015

### MFIP — Combined Cash and Food Assistance

Minnesota's most structurally distinctive program:
- **Combined grant:** MFIP uniquely bundles TANF cash assistance and SNAP-equivalent food assistance in a single grant. No other state combines these programs this way.
- **Federal time limit:** 60-month federal lifetime limit applies
- **DWP diversion:** Diversionary Work Program provides 4 months of MFIP-level benefits with intensive employment services before full MFIP entry
- **Food portion tracking:** The `mfipFoodPortionAmount` field tracks the food portion separately for federal reporting purposes
- **Child support:** Good cause exemption includes domestic violence per Family Violence Option
- **Policy basis:** Minn. Stat. § 256J

### Medical Assistance Expansion and MinnesotaCare

Minnesota has a complex health coverage architecture:
- **Expansion adults:** 138% FPL for adults 19–64 under ACA expansion (Medical Assistance MAGI)
- **Pregnant women:** 278% FPL through Medical Assistance
- **Children:** 275% FPL through Medical Assistance
- **MinnesotaCare:** Covers adults and children with incomes above MA limits but below 200% FPL. Broader than CHIP — MinnesotaCare covers adults, not just children. Maps to the CHIP column as the closest federal analog.
- **Immigration coverage:** MinnesotaCare covers lawfully present non-citizens; MA covers pregnant women regardless of immigration status
- **1634 state:** SSI recipients receive automatic Medical Assistance enrollment
- **MA-EPD:** Medical Assistance for Employed Persons with Disabilities — working disabled buy-in program up to 250% FPL (Minn. Stat. § 256B.057 subd. 9)
- **TEFRA:** Children with disabilities eligible for MA regardless of parental income; family pays a parental fee based on income (Minn. Stat. § 256B.055 subd. 12)
- **MA Aid Categories:** Categories include MA-MAGI, MA-LTC, MA-EPD, TEFRA, MinnesotaCare

### Medical Assistance Non-MAGI (Long-Term Care / Aged / Disabled)

- **Asset limit:** $3,000 individual / $6,000 couple (MN adopted higher limits effective 2024, per Minn. Stat. § 256B.056)
- **Look-back period:** 60 months (MN uses the federal standard — did NOT shorten like California)
- **MERP:** Minnesota Medical Assistance Estate Recovery Program is among the most aggressive in the nation (Minn. Stat. § 256B.15)

### County Administration and Dual Eligibility Systems

Minnesota's 87 counties each administer benefits programs through a unique dual-system architecture:
- **MAXIS:** Eligibility system for cash and food programs (SNAP, MFIP, GA, MSA, EA)
- **METS:** Minnesota Eligibility Technology System for health care programs (MA, MinnesotaCare)
- The `countyCode` field identifies the administering county
- `maborCaseNumber` tracks cases across both systems
- `maxisClientId` identifies clients in the MAXIS system

### EAP (LIHEAP) Differences

- **Income threshold:** 50% of state median income
- **Year-round:** No seasonal restriction (unlike Colorado's Nov–Apr heating season)
- **Crisis component:** Emergency assistance for imminent disconnection or fuel shortage, available year-round
- **Administration:** Community action agencies and tribal nations (not county offices)
- **Heat/eat:** Minimal EAP benefit confers SNAP Standard Utility Allowance (SUA) eligibility
- **Policy basis:** Minn. Stat. § 216C.14

### SSI/MSA State Supplement

Minnesota is a **1634 state**, meaning SSA administers the federal SSI payment, but MSA (Minnesota Supplemental Aid) is administered separately by counties. The `msaAmount` field captures the state supplement, which includes:
- Housing assistance supplement
- Special diet supplement
- Policy basis: Minn. Stat. § 256D.35–.46

## Minnesota Regulatory Citation Guide

The overlay uses two citation formats:

| Format | Source | Example |
|--------|--------|---------|
| **Minn. Stat. §** | Minnesota Statutes | Minn. Stat. § 256B.055 |
| **Minn. R.** | Minnesota Rules (administrative code) | Minn. R. 9505.0015 |

Key regulatory sources:
- **Minn. Stat. § 256B** — Medical Assistance statutes
- **Minn. Stat. § 256D** — General Assistance, MSA statutes
- **Minn. Stat. § 256J** — MFIP statutes
- **Minn. Stat. § 256L** — MinnesotaCare statutes
- **Minn. Stat. § 216C** — Energy Assistance Program statutes
- **Minn. Stat. § 393** — County human services administration
- **Minn. R. 9505** — Department of Human Services rules (cash, food, and health care programs)
- **Minn. R. 4105** — Energy assistance rules

## Minnesota-Specific System Fields

The overlay adds five system fields used across Minnesota programs:

| Field | Entity | Purpose |
|-------|--------|---------|
| `countyCode` | Household | Identifies which of the 87 county offices administers the case |
| `maborCaseNumber` | Application | MAXIS/METS case tracking number |
| `minnesotaResidencyVerified` | Household | Confirms Minnesota residency for state-administered programs |
| `maxisClientId` | Person | MAXIS eligibility system client identifier |
| `maAidCategory` | Person | Determines Medical Assistance benefit set and funding source |

## Confidence and SME Review

This overlay represents a **first draft** compiled from publicly available Minnesota statutes, rules, and policy documents. It should be reviewed by Minnesota-specific subject matter experts before use in production systems.

Areas that particularly benefit from SME review:
- MFIP combined grant mechanics and food portion calculation methodology
- DWP eligibility criteria and transition to full MFIP
- MA-EPD income limits and employment verification requirements
- TEFRA parental fee calculation
- MinnesotaCare vs. Medical Assistance boundary (adults 138%–200% FPL)
- MSA housing assistance and special diet supplement amounts and eligibility
- GA eligibility criteria beyond what is codified in Minn. Stat. § 256D
- EA crisis criteria and county-level variation
- MERP estate recovery scope and exemptions
- MAXIS/METS dual system integration and case number formats
- Code for America MNbenefits alignment opportunities

## Future State Overlays

Additional states follow the same pattern in this directory:
- `{state}-benefits-overlay.csv` — State overlay CSV
- `{state}-benefits-overlay-guide.md` — Companion guide

Each state overlay uses the same column structure and OverlayAction semantics, with the number of columns varying by state based on the number of state-only programs.
