# California Benefits Overlay Guide

This guide explains how to read and use the [California Benefits Overlay CSV](california-benefits-overlay.csv) alongside the [Federal Benefits Data Model](../federal-benefits-data-model.csv).

## How to Read the Overlay

The overlay CSV contains **only differences** from the federal baseline. It does not repeat unchanged fields.

### OverlayAction Values

| Action | Meaning |
|--------|---------|
| `update` | Modifies an existing federal field. Blank cells mean "same as federal" — only populated cells represent California-specific differences. |
| `remove` | California does not collect this field. The field exists in the federal model but is not used in California's implementation. |
| `add` | A new California-only field not present in the federal model. The Entity must exist in the federal model (e.g., Person, Household). |
| `add_program` | Introduces a state-only program with no federal counterpart. The program column (CAPI, CFAP, or GA/GR) is marked `Program`. |

### Blank Cell Rule

For `update` rows, **blank = same as federal**. Only cells that differ from the federal model are populated. This keeps the overlay compact and makes differences immediately visible.

### How to Cross-Reference

1. Open both the federal CSV and the California overlay CSV
2. For each overlay row, find the matching **Entity + Field** pair in the federal CSV
3. Any populated cell in the overlay overrides the corresponding federal value
4. Any blank cell in the overlay means the federal value applies unchanged

## California Program Mapping

California implements all 10 federal programs, often under state-specific names and with different administering agencies.

| Federal Program | California Name | Administering Agency | Key Difference |
|----------------|-----------------|---------------------|----------------|
| SNAP | CalFresh | County Departments of Social Services via CalSAWS | BBCE: 200% FPL gross income, no asset test |
| Medicaid (MAGI) | Medi-Cal (MAGI) | County DSS via CalSAWS / DHCS | 138% FPL adults, 213% pregnant, coverage regardless of immigration status |
| Medicaid (Non-MAGI) | Medi-Cal (Non-MAGI) | County DSS via CalSAWS / DHCS | $130,000 asset limit, 30-month look-back, 250% FPL Working Disabled |
| TANF | CalWORKs | County DSS (58 counties) | 48-month state time limit, Safety Net for children, Cal-Learn |
| SSI | SSI/SSP | SSA (federal SSI) + CDSS (SSP supplement) | 1616(a) state supplement, amount varies by living arrangement |
| WIC | California WIC | CDPH (CA Dept of Public Health), 84 local agencies | Federal rules, CA-administered |
| CHIP | Medi-Cal (Children) | DHCS (Dept of Health Care Services) | No separate CHIP — children covered under Medi-Cal to 266% FPL |
| Section 8 Housing | Section 8 Housing | 100+ local Public Housing Authorities | State source-of-income discrimination protections |
| LIHEAP | CA LIHEAP | Community action agencies / CDSS | 60% SMI, year-round (no seasonal restriction) |
| Summer EBT | SUN Bucks | CDSS / CDE joint administration | Follows federal structure |

## State-Only Programs

These programs have no federal counterpart. They appear as `add_program` rows in the overlay and have their own program columns (columns 18–20).

### CAPI — Cash Assistance Program for Immigrants
- **Eligibility:** Aged (65+), blind, or disabled non-citizens ineligible for SSI due to immigration status
- **Funding:** State-funded under WIC § 18937
- **Benefit:** Monthly cash assistance mirroring SSI/SSP payment levels
- **Resources:** $2,000 individual / $3,000 couple (follows SSI resource rules)
- **Administration:** County Departments of Social Services

### CFAP — California Food Assistance Program
- **Eligibility:** Legal immigrants (qualified aliens) ineligible for federal SNAP
- **Funding:** State-funded under WIC § 18930
- **Benefit:** Monthly food assistance following CalFresh BBCE rules (200% FPL gross, no asset test)
- **Administration:** County Departments of Social Services

### GA/GR — General Assistance / General Relief
- **Eligibility:** Indigent adults ineligible for other cash assistance programs
- **Funding:** County-funded under WIC § 17000
- **Benefit:** Monthly cash assistance (amount and duration vary significantly by county)
- **Administration:** County Departments of Social Services (58 counties, each with distinct rules)

## Key California Policy Differences

### Broad-Based Categorical Eligibility (BBCE) for CalFresh

California uses BBCE, which significantly changes SNAP eligibility:
- **Income threshold:** 200% FPL gross income (vs. federal 130% gross / 100% net)
- **No asset test:** Asset fields from the federal model are marked `Not Required` for CalFresh
- **No lottery disqualification:** `substantialLotteryWinnings` and `lotteryWinningsAmount` are removed under BBCE
- **SSI cash-out ended:** AB 1811 (2018) ended the SSI cash-out; SSI recipients are now CalFresh-eligible
- **Policy basis:** WIC § 18901.1; MPP 63-503

### Medi-Cal (Medicaid) Expansion and Immigration Coverage

- **Expansion adults:** 138% FPL for adults 19–64 under ACA expansion
- **Pregnant women:** 213% FPL through Medi-Cal
- **Children:** 266% FPL — no separate CHIP program; children covered under Medi-Cal
- **Immigration coverage:** All income-eligible adults receive full-scope Medi-Cal regardless of immigration status (state-funded via AB 133 / SB 56, effective 2024)
- **No 5-year bar:** California funds coverage for qualified immigrants during the federal 5-year waiting period
- **Working Disabled:** 250% FPL Buy-In program (WIC § 14007.9)
- **1634 state:** SSI/SSP recipients receive automatic Medi-Cal enrollment
- **Medi-Cal Aid Codes:** Over 200 aid codes determine benefit package and funding source

### Medi-Cal Non-MAGI (Long-Term Care / Aged / Disabled)

- **Asset limit:** $130,000/person + $65,000/additional household member (effective 2024, codified for 2026+, per WIC § 14005.40)
- **Look-back period:** 30 months (vs. federal 60-month look-back)
- **Share of Cost:** California's medically needy spend-down, functionally equivalent to federal spend-down (WIC § 14005.7)

### CalWORKs (TANF)

- **State time limit:** 48 months (vs. 60-month federal lifetime limit)
- **Safety Net:** Children continue to receive cash aid after the adult times out of CalWORKs
- **Cal-Learn:** Mandatory program for pregnant and parenting teens
- **Resource limits:** $12,137 / $18,206 for elderly-disabled households (adjusted annually)
- **Vehicle equity:** $33,499 exemption (adjusted annually, per MPP 42-221)
- **County administration:** 58 counties, two MAP (Monthly Assistance Payment) regions

### County Administration

California's 58 counties each administer benefits programs:
- The `countyCode` field (added in the overlay) identifies the administering county
- CalSAWS (California Statewide Automated Welfare System) is the unified eligibility system
- `calsawsCaseNumber` and `calsawsClientId` track cases and clients across counties
- GA/GR rules vary significantly by county — some provide 30 days of aid, others provide ongoing assistance

### SSI/SSP State Supplement

California is a **1616(a) state**, meaning CDSS sets SSP (State Supplementary Payment) amounts, but SSA makes the combined SSI/SSP payment. The `sspAmount` and `sspLivingArrangementCategory` fields capture the California-specific supplement, which varies by living arrangement (independent living receives the highest amount).

### CA LIHEAP Differences

- **Income threshold:** 60% of state median income
- **Year-round:** No seasonal restriction (unlike Colorado's Nov–Apr heating season)
- **Administration:** Community action agencies (not county offices)
- **Heat/eat:** Minimal CA LIHEAP benefit confers CalFresh Standard Utility Allowance (SUA) eligibility

## California Regulatory Citation Guide

The overlay uses several citation formats:

| Format | Source | Example |
|--------|--------|---------|
| **WIC §** | Welfare and Institutions Code | WIC § 14005.40 |
| **MPP** | Manual of Policies and Procedures | MPP 63-503 |
| **CCR** | California Code of Regulations | 22 CCR 39-103 |
| **AB / SB** | Assembly Bill / Senate Bill | AB 133; SB 56 |

Key regulatory sources:
- **WIC Title 14** — Medi-Cal statutes (§ 14000–14199)
- **WIC Title 18** — CalFresh, CAPI, CFAP statutes (§ 18900–18937)
- **WIC Title 11** — CalWORKs statutes (§ 11100–11526)
- **WIC Title 12** — SSP statutes (§ 12000–12350)
- **WIC Title 17** — GA/GR (§ 17000)
- **MPP 40–44** — CalWORKs regulations
- **MPP 63** — CalFresh regulations
- **22 CCR 39** — LIHEAP regulations
- **22 CCR 50000+** — Medi-Cal aid code regulations

## California-Specific System Fields

The overlay adds five system fields used across California programs:

| Field | Entity | Purpose |
|-------|--------|---------|
| `countyCode` | Household | Identifies which of the 58 county offices administers the case |
| `calsawsCaseNumber` | Application | CalSAWS case tracking number |
| `californiaResidencyVerified` | Household | Confirms California residency for state-administered programs |
| `calsawsClientId` | Person | CalSAWS client identifier |
| `mediCalAidCode` | Person | Determines Medi-Cal benefit package and funding source |

## Confidence and SME Review

This overlay represents a **first draft** compiled from publicly available California statutes, regulations, and policy documents. It should be reviewed by California-specific subject matter experts before use in production systems.

Areas that particularly benefit from SME review:
- Medi-Cal aid code mapping and funding source categorization
- CalWORKs county-level variation in resource limits and exemptions
- CAPI resource limit alignment with current SSI rules
- CFAP BBCE interaction (does CFAP follow identical BBCE rules as CalFresh?)
- GA/GR county-specific eligibility and benefit levels
- SSP payment amounts by living arrangement category
- Immigration coverage categories and state-funded vs. federally-funded Medi-Cal boundaries
- CA LIHEAP community action agency administration model

## Future State Overlays

Additional states follow the same pattern in this directory:
- `{state}-benefits-overlay.csv` — State overlay CSV
- `{state}-benefits-overlay-guide.md` — Companion guide

Each state overlay uses the same column structure and OverlayAction semantics, with the number of columns varying by state based on the number of state-only programs.
