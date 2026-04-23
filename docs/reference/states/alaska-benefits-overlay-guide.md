# Alaska Benefits Overlay Guide

This guide explains how to read and use the [Alaska Benefits Overlay CSV](alaska-benefits-overlay.csv) alongside the [Federal Benefits Data Model](../federal-benefits-data-model.csv).

## How to Read the Overlay

The overlay CSV contains **only differences** from the federal baseline. It does not repeat unchanged fields.

### OverlayAction Values

| Action | Meaning |
|--------|---------|
| `update` | Modifies an existing federal field. Blank cells mean "same as federal" — only populated cells represent Alaska-specific differences. |
| `remove` | Alaska does not collect this field. The field exists in the federal model but is not used in Alaska's implementation. |
| `add` | A new Alaska-only field not present in the federal model. The Entity must exist in the federal model (e.g., Person, Household). |
| `add_program` | Introduces a state-only program with no federal counterpart. The program column (APA, AK GA, or Senior Benefits) is marked `Program`. |

### Blank Cell Rule

For `update` rows, **blank = same as federal**. Only cells that differ from the federal model are populated. This keeps the overlay compact and makes differences immediately visible.

### How to Cross-Reference

1. Open both the federal CSV and the Alaska overlay CSV
2. For each overlay row, find the matching **Entity + Field** pair in the federal CSV
3. Any populated cell in the overlay overrides the corresponding federal value
4. Any blank cell in the overlay means the federal value applies unchanged

## Alaska Program Mapping

Alaska implements all 10 federal programs, several under distinctive state names. Alaska's policy architecture is the most structurally distinctive among US states due to the Permanent Fund Dividend interaction with means-tested programs, the absence of county government, Alaska-specific (higher) poverty guidelines, and extensive tribal administration.

| Federal Program | Alaska Name | Administering Agency | Key Difference |
|----------------|-------------|---------------------|----------------|
| SNAP | AK SNAP | Division of Public Assistance via ARIES | BBCE: 200% FPL gross income, no asset test. PFD counts as income. Alaska poverty guidelines. |
| Medicaid (MAGI) | Alaska Medicaid (MAGI) | Division of Public Assistance via ARIES | 138% FPL adults (Alaska guidelines); tribal health integration; 229 federally recognized tribes |
| Medicaid (Non-MAGI) | Alaska Medicaid (Non-MAGI) | Division of Public Assistance via ARIES | 1634 state; SSI auto-enrollment; Medicaid Buy-In for workers with disabilities |
| TANF | ATAP (Alaska Temporary Assistance Program) | Division of Public Assistance via ARIES | 60-month federal limit; strong tribal TANF presence; multiple tribal TANF programs |
| SSI | SSI | Social Security Administration | Federal program + APA state supplement (1634 state) |
| WIC | Alaska WIC | Division of Public Health, local agencies | Federal rules, AK-administered; subsistence food considerations |
| CHIP | Denali KidCare | Division of Public Assistance via ARIES | Children to 200% FPL, pregnant women to 200% FPL (Alaska guidelines); covers lawfully present children |
| Section 8 Housing | Section 8 Housing | AHFC (Alaska Housing Finance Corporation), local PHAs | AHFC is both the state housing authority and a local PHA |
| LIHEAP | AK Heating Assistance | AHFC (Alaska Housing Finance Corporation) | 150% FPL (Alaska guidelines); extreme heating costs; remote fuel delivery challenges |
| Summer EBT | AK Summer EBT | Division of Public Assistance | Federal rules, AK-administered |

## State-Only Programs

These programs have no federal counterpart. They appear as `add_program` rows in the overlay and have their own program columns (columns 17-19).

### APA — Adult Public Assistance
- **Eligibility:** Aged (65+), blind, or disabled individuals meeting SSI criteria
- **Funding:** State-funded under AS 47.25.430
- **Benefit:** Monthly state supplement to SSI; amount varies by living arrangement and other income
- **Administration:** Division of Public Assistance (Alaska is a 1634 state — SSA administers federal SSI but APA is state-administered)

### AK GA — General Assistance
- **Eligibility:** Individuals pending SSI determination; interim cash assistance
- **Funding:** State-funded under AS 47.25.430
- **Benefit:** Interim assistance while SSI application is pending; recipients must apply for and cooperate with SSI application
- **Administration:** Division of Public Assistance

### Senior Benefits
- **Eligibility:** Low-income Alaskans aged 65 and older
- **Funding:** State-funded under AS 47.45.301
- **Benefit:** $250/month for qualifying seniors; income threshold based on FPL (Alaska guidelines)
- **Administration:** Division of Public Assistance

## Key Alaska Policy Differences

### Permanent Fund Dividend (PFD) Interaction with Benefits

Alaska's most structurally distinctive policy feature:
- **What it is:** The Alaska Permanent Fund Dividend is an annual payment ($1,000-$3,200/year depending on year) to every eligible Alaska resident from the state's oil wealth fund
- **Income counting:** PFD counts as unearned income for SNAP and other means-tested programs. The `pfdIncomeAmount` field captures this amount.
- **Timing:** PFD is paid annually in October; must be annualized for monthly income calculations
- **Unique among states:** No other state has an analogous universal payment that interacts with federal benefits eligibility
- **Residency:** PFD residency requirements are stricter than benefits program residency requirements
- **Policy basis:** AS 43.23; 7 AAC 46.010

### Alaska Poverty Guidelines (25% Higher Than Lower 48)

Alaska uses separate, higher Federal Poverty Level guidelines, approximately 25% higher than the contiguous 48 states:
- **Impact:** All FPL-based thresholds in Alaska are effectively higher in dollar terms
- **Programs affected:** SNAP, Medicaid, ATAP, Denali KidCare, Heating Assistance, Senior Benefits, and all other FPL-based programs
- **Example:** 138% FPL for a family of 4 in Alaska is higher than 138% FPL for the same family size in the lower 48
- **Federal basis:** The Department of Health and Human Services publishes separate Alaska (and Hawaii) poverty guidelines annually

### No Counties — Boroughs and Census Areas

Alaska is the only state without county government:
- **Structure:** 19 organized boroughs and 10 census areas (29 total geographic divisions)
- **Unorganized Borough:** Much of the state falls within the Unorganized Borough, which has no borough-level government
- **Overlay field:** `boroughCode` replaces `countyCode` used in other state overlays
- **Policy basis:** AS 29.03

### Tribal Administration (229 Federally Recognized Tribes)

Alaska has the most federally recognized tribes of any state:
- **Tribal TANF:** Multiple tribal TANF programs operate independently with separate time limits and work requirements. Tribal TANF months may not count toward state ATAP limit.
- **Tribal health:** Alaska Natives eligible for Indian Health Service (IHS) and tribal health services. Tribal health referrals qualify for 100% FMAP under Medicaid.
- **FDPIR:** Food Distribution Program on Indian Reservations is significant in Alaska, particularly in rural communities
- **tribalHealthEligible field:** Captures IHS/tribal health eligibility for Medicaid billing and coordination of benefits
- **Policy basis:** 25 USC 1601 et seq.; AS 47.07

### Broad-Based Categorical Eligibility (BBCE) for SNAP

Alaska uses BBCE, which significantly changes SNAP eligibility:
- **Income threshold:** 200% FPL gross income (vs. federal 130% gross / 100% net), using Alaska poverty guidelines
- **No asset test:** Asset fields from the federal model are marked `Not Required` for AK SNAP
- **No lottery disqualification:** `substantialLotteryWinnings` and `lotteryWinningsAmount` are removed under BBCE
- **PFD interaction:** PFD counts as income toward the 200% FPL threshold
- **ABAWD waivers:** Alaska has obtained statewide ABAWD waivers due to qualifying unemployment rates and lack of sufficient employment opportunities in rural areas
- **Policy basis:** AS 47.25.430; 7 AAC 46

### Extreme Heating Costs and Remote Fuel Delivery

Heating assistance is uniquely critical in Alaska:
- **Cost magnitude:** Average annual heating costs in rural Alaska can exceed $8,000; heating season costs exceed $5,000 in many rural areas
- **Fuel type:** Fuel oil is the predominant heating fuel in rural Alaska; natural gas is primarily available only in Anchorage/Fairbanks metro areas
- **Remote delivery:** Many rural communities are off the road system and require barge or air fuel delivery, with some communities having only one annual barge delivery window
- **heatingFuelDeliveryRemote field:** Captures whether the household requires remote fuel delivery, which affects benefit calculation
- **Administration:** Alaska Housing Finance Corporation (AHFC) administers both Heating Assistance and Section 8 Housing
- **Heat/eat:** Heating Assistance benefit confers SNAP Standard Utility Allowance (SUA) eligibility
- **Policy basis:** AS 44.83.390; 15 AAC 155

### AHFC — Alaska Housing Finance Corporation

AHFC plays a dual role unique among state housing agencies:
- Administers **AK Heating Assistance** (LIHEAP)
- Serves as both the **state housing authority** and a **local Public Housing Authority** for Section 8
- **Policy basis:** AS 18.56; AS 44.83

### Medicaid: Tribal Health Integration and Denali KidCare

Alaska's Medicaid program has distinctive features:
- **Expansion adults:** 138% FPL for adults 19-64 under ACA expansion (Alaska Medicaid MAGI), using Alaska poverty guidelines
- **Denali KidCare:** Children to 200% FPL, pregnant women to 200% FPL (Alaska guidelines); covers lawfully present children and pregnant women
- **1634 state:** SSI recipients receive automatic Medicaid enrollment
- **Tribal health integration:** Alaska Natives enrolled in tribal health may qualify for 100% FMAP services; 229 federally recognized tribes
- **Medicaid Buy-In:** Program for workers with disabilities under the Ticket to Work and Work Incentives Improvement Act (AS 47.07.045)
- **Policy basis:** AS 47.07; 7 AAC 100

### ATAP — Alaska Temporary Assistance Program

- **Time limit:** 60-month federal lifetime limit applies
- **Tribal TANF:** Strong tribal TANF presence; multiple tribal TANF programs operate independently with separate time limits and work requirements
- **Child support:** Good cause exemption includes domestic violence per Family Violence Option; Alaska CSSD handles enforcement
- **Policy basis:** AS 47.27; 7 AAC 45

### SSI/APA State Supplement

Alaska is a **1634 state**, meaning SSA administers the federal SSI payment, but APA (Adult Public Assistance) is administered separately by the Division of Public Assistance. The `apaAmount` field captures the state supplement for:
- Aged individuals (65+)
- Blind individuals
- Disabled individuals
- Benefit varies by living arrangement and other income
- Policy basis: AS 47.25.430; 7 AAC 40

## Alaska Regulatory Citation Guide

The overlay uses two citation formats:

| Format | Source | Example |
|--------|--------|---------|
| **AS** | Alaska Statutes | AS 47.25.430 |
| **AAC** | Alaska Administrative Code | 7 AAC 46 |

Key regulatory sources:
- **AS 47.07** — Medicaid statutes
- **AS 47.25.430** — Public assistance statutes (APA, GA)
- **AS 47.27** — Alaska Temporary Assistance Program (ATAP) statutes
- **AS 47.45.301** — Senior Benefits statutes
- **AS 43.23** — Permanent Fund Dividend statutes
- **AS 44.83** — Alaska Housing Finance Corporation statutes
- **AS 47.05** — Department of Health and Social Services general provisions
- **AS 29.03** — Borough organization and classification
- **AS 44.12.310** — Official languages of the state
- **7 AAC 40** — Adult Public Assistance rules
- **7 AAC 45** — Alaska Temporary Assistance Program rules
- **7 AAC 46** — SNAP / food stamp rules
- **7 AAC 47** — Senior Benefits rules
- **7 AAC 100** — Medicaid rules
- **7 AAC 10** — General eligibility provisions
- **15 AAC 155** — Heating assistance rules

## Alaska-Specific System Fields

The overlay adds four system fields used across Alaska programs:

| Field | Entity | Purpose |
|-------|--------|---------|
| `boroughCode` | Household | Identifies which of the 29 boroughs/census areas the household resides in (Alaska has no counties) |
| `ariesCaseNumber` | Application | ARIES (Alaska Resource for Integrated Eligibility Services) case tracking number |
| `alaskaResidencyVerified` | Household | Confirms Alaska residency for state-administered programs |
| `ariesClientId` | Person | ARIES eligibility system client identifier |

## Alaska-Specific Data Fields

| Field | Entity | Purpose |
|-------|--------|---------|
| `pfdIncomeAmount` | Income | Permanent Fund Dividend amount; counts as unearned income for means-tested programs |
| `tribalHealthEligible` | Person | Indian Health Service / tribal health eligibility for Medicaid coordination |
| `medicaidBuyInEligible` | Person | Medicaid Buy-In for Workers with Disabilities eligibility |
| `medicaidBuyInEmploymentVerified` | Person | Employment verification for Medicaid Buy-In |
| `apaAmount` | Person | Adult Public Assistance state supplement amount |
| `heatingFuelDeliveryRemote` | Household | Remote fuel delivery indicator for heating assistance calculation |

## Confidence and SME Review

This overlay represents a **first draft** compiled from publicly available Alaska statutes, administrative code, and policy documents. It should be reviewed by Alaska-specific subject matter experts before use in production systems.

Areas that particularly benefit from SME review:
- PFD income counting rules: exact treatment as lump-sum vs. annualized income across programs; timing of PFD distribution and impact on monthly eligibility calculations
- BBCE status verification: confirm Alaska's current BBCE implementation details and whether 200% FPL gross income threshold is current
- Tribal TANF specifics: interaction between state ATAP months and tribal TANF months; which tribal TANF programs operate in Alaska and their specific provisions
- Denali KidCare thresholds: confirm 200% FPL for children and pregnant women; verify lawfully present coverage scope
- Remote community provisions: fuel delivery logistics, subsistence food considerations for WIC and SNAP, and how geographic remoteness affects program administration
- APA/GA benefit levels: current APA supplement amounts by living arrangement; GA interim assistance amounts and duration
- Tribal health/Medicaid coordination: 100% FMAP billing procedures for tribal health referrals; IHS/tribal health facility definitions
- ABAWD waiver status: confirm statewide vs. partial waiver status; which areas currently qualify
- Heating Assistance benefit calculation: how remote fuel delivery affects benefit amounts; AHFC administration procedures
- Senior Benefits income thresholds: current FPL percentage thresholds and verification requirements
- ARIES system integration: case number formats, client ID formats, system capabilities and limitations
- Borough/census area administration: how the Unorganized Borough is handled for benefits administration purposes

## Future State Overlays

Additional states follow the same pattern in this directory:
- `{state}-benefits-overlay.csv` — State overlay CSV
- `{state}-benefits-overlay-guide.md` — Companion guide

Each state overlay uses the same column structure and OverlayAction semantics, with the number of columns varying by state based on the number of state-only programs.
