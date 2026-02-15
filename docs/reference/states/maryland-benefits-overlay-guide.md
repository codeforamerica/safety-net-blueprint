# Maryland Benefits Overlay Guide

This guide explains how to read and use the [Maryland Benefits Overlay CSV](maryland-benefits-overlay.csv) alongside the [Federal Benefits Data Model](../federal-benefits-data-model.csv).

## How to Read the Overlay

The overlay CSV contains **only differences** from the federal baseline. It does not repeat unchanged fields.

### OverlayAction Values

| Action | Meaning |
|--------|---------|
| `update` | Modifies an existing federal field. Blank cells mean "same as federal" — only populated cells represent Maryland-specific differences. |
| `remove` | Maryland does not collect this field. The field exists in the federal model but is not used in Maryland's implementation. |
| `add` | A new Maryland-only field not present in the federal model. The Entity must exist in the federal model (e.g., Person, Household). |
| `add_program` | Introduces a state-only program with no federal counterpart. The program column (TDAP, PAA, or CCS) is marked `Program`. |

### Blank Cell Rule

For `update` rows, **blank = same as federal**. Only cells that differ from the federal model are populated. This keeps the overlay compact and makes differences immediately visible.

### How to Cross-Reference

1. Open both the federal CSV and the Maryland overlay CSV
2. For each overlay row, find the matching **Entity + Field** pair in the federal CSV
3. Any populated cell in the overlay overrides the corresponding federal value
4. Any blank cell in the overlay means the federal value applies unchanged

## Maryland Program Mapping

Maryland implements all 10 federal programs, with several operating under distinctive state names. Maryland's benefits system is notable for MCHP's generous 317% FPL threshold for children (one of the highest nationally), the MD THINK integrated technology platform, and a jurisdiction-based administration model spanning 24 jurisdictions (23 counties + Baltimore City).

| Federal Program | Maryland Name | Administering Agency | Key Difference |
|----------------|---------------|---------------------|----------------|
| SNAP | MD SNAP | Local DSS offices via MD THINK | BBCE: 200% FPL gross income, no asset test |
| Medicaid (MAGI) | Maryland Medicaid (MAGI) | Local DSS offices / MDH | 138% FPL adults, 264% FPL pregnant women, 317% FPL children (MCHP) |
| Medicaid (Non-MAGI) | Maryland Medicaid (Non-MAGI) | Local DSS offices / MDH | Standard; MD is a 1634 state |
| TANF | TCA (Temporary Cash Assistance) | Local DSS offices | 60-month federal limit applies; county-administered |
| SSI | SSI | Social Security Administration | Federal program + MD state supplement (1634 state) |
| WIC | Maryland WIC | MDH (MD Dept of Health), local agencies | Federal rules, MD-administered |
| CHIP | MCHP (Maryland Children's Health Program) | MDH / local DSS offices | Children to 317% FPL (one of the most generous nationally) |
| Section 8 Housing | Section 8 Housing | Local Public Housing Authorities | Administered by local PHAs |
| LIHEAP | MEAP (Maryland Energy Assistance Program) | OHEP (Office of Home Energy Programs) | 175% FPL; year-round; OHEP administers |
| Summer EBT | MD Summer EBT | DHS | Federal rules, MD-administered |

## State-Only Programs

These programs have no federal counterpart. They appear as `add_program` rows in the overlay and have their own program columns (columns 17-19).

### TDAP — Temporary Disability Assistance Program
- **Eligibility:** Disabled adults who are pending or ineligible for SSI
- **Funding:** State-funded under Md. Code, Hum. Servs. § 5-501; COMAR 07.03.24
- **Benefit:** $185/month maximum cash assistance
- **Administration:** Local Departments of Social Services (24 jurisdictions)
- **Key detail:** TDAP serves as a critical safety net for disabled adults who have not yet been approved for SSI or who do not meet SSI criteria but have a verified disability

### PAA — Public Assistance to Adults
- **Eligibility:** Elderly individuals age 65+ and legally blind adults
- **Funding:** State-funded under Md. Code, Hum. Servs. § 4-501; COMAR 07.03.05
- **Benefit:** Supplemental cash assistance for basic needs
- **Administration:** Local Departments of Social Services

### CCS — Child Care Subsidy
- **Eligibility:** Working families with income up to 65% of state median income (SMI)
- **Funding:** State and federal funds under COMAR 13A.14; Md. Code, Educ. § 9.5-101
- **Benefit:** Subsidized child care with co-payments based on family size and income
- **Administration:** MSDE (Maryland State Department of Education)
- **Key detail:** Requires employment, job training, or education activity; covers children age 0-12 (up to 18 with special needs)

## Key Maryland Policy Differences

### Broad-Based Categorical Eligibility (BBCE) for SNAP

Maryland uses BBCE, which significantly changes SNAP eligibility:
- **Income threshold:** 200% FPL gross income (vs. federal 130% gross / 100% net)
- **No asset test:** Asset fields from the federal model are marked `Not Required` for MD SNAP
- **No lottery disqualification:** `substantialLotteryWinnings` and `lotteryWinningsAmount` are removed under BBCE
- **Policy basis:** COMAR 07.03.17; Md. Code, Hum. Servs. § 5-501

### MCHP — Maryland Children's Health Program

Maryland's CHIP implementation is one of the most generous nationally:
- **Children:** 317% FPL through MCHP (among the highest thresholds in the country)
- **Pregnant women:** 264% FPL through Maryland Medicaid
- **Expansion adults:** 138% FPL for adults 19-64 under ACA expansion (Maryland Medicaid MAGI)
- **Immigration coverage:** MCHP covers lawfully present children and pregnant women regardless of immigration status under the CHIPRA option
- **1634 state:** SSI recipients receive automatic Maryland Medicaid enrollment
- **EID program:** Employed Individuals with Disabilities (EID) — working disabled buy-in for Medical Assistance
- **Aid Categories:** Include MA-MAGI, MA-LTC, EID, MCHP, Medicaid for Families

### Medical Assistance Non-MAGI (Long-Term Care / Aged / Disabled)

- **Asset limit:** $2,000 individual / $3,000 couple (standard federal limits)
- **Look-back period:** 60 months (federal standard)
- **Estate recovery:** Follows federal standards under Md. Code, Health-Gen. § 15-121

### TCA — Temporary Cash Assistance

Maryland's TANF implementation:
- **Federal time limit:** 60-month federal lifetime limit applies
- **Administration:** County-administered through 24 local Departments of Social Services
- **Child support:** Good cause exemption includes domestic violence per Family Violence Option
- **Policy basis:** Md. Code, Hum. Servs. § 5-301; COMAR 07.03.03

### 24-Jurisdiction Administration Model

Maryland's 24 jurisdictions each operate a local Department of Social Services that administers benefits programs:
- **23 counties** plus **Baltimore City** (an independent city, not part of any county)
- The `jurisdictionCode` field identifies which local DSS office administers the case
- All jurisdictions use the **MD THINK** platform for integrated case management
- TCA and other programs may have county-level variation in implementation

### MD THINK Platform

MD THINK (Total Human-services Integrated Network) is Maryland's integrated eligibility and case management platform:
- **Code for America** is actively building the Maryland Benefits application on MD THINK
- `mdThinkCaseNumber` tracks cases across programs
- `mdThinkClientId` identifies clients across all state-administered programs
- The platform supports integrated eligibility determination across multiple programs

### MEAP (LIHEAP) Differences

- **Income threshold:** 175% of federal poverty level
- **Year-round:** No seasonal restriction
- **Crisis component:** Emergency assistance for imminent disconnection or fuel shortage, available year-round
- **Administration:** OHEP (Office of Home Energy Programs) within DHS — not local DSS offices
- **SUA linkage:** MEAP benefit confers SNAP Standard Utility Allowance (SUA) eligibility
- **Policy basis:** Md. Code, Hum. Servs. § 5-5A-01; COMAR 07.06.16

### SSI State Supplement

Maryland is a **1634 state**, meaning SSA administers both the federal SSI payment and the state supplement. The `mdStateSupplementAmount` field captures the state supplement, which varies by living arrangement.
- **Policy basis:** Md. Code, Hum. Servs. § 4-401

### TDAP as Safety Net for Disabled Adults

TDAP fills a critical gap for disabled adults who are:
- Awaiting SSI determination (which can take months or years)
- Ineligible for SSI but have a verified temporary or permanent disability
- Not eligible for TCA (e.g., single adults without children)

At $185/month maximum, TDAP provides minimal but essential cash assistance during the often-lengthy SSI application process.

## Maryland Regulatory Citation Guide

The overlay uses two citation formats:

| Format | Source | Example |
|--------|--------|---------|
| **Md. Code** | Annotated Code of Maryland | Md. Code, Hum. Servs. § 5-501 |
| **COMAR** | Code of Maryland Regulations | COMAR 07.03.17 |

Key regulatory sources:
- **Md. Code, Health-Gen. § 15-103** — Maryland Medical Assistance (Medicaid/MCHP) statutes
- **Md. Code, Health-Gen. § 15-121/122** — Estate recovery and asset transfer statutes
- **Md. Code, Hum. Servs. § 5-301** — TCA (Temporary Cash Assistance) statutes
- **Md. Code, Hum. Servs. § 5-501** — TDAP statutes
- **Md. Code, Hum. Servs. § 4-401** — SSI state supplement statutes
- **Md. Code, Hum. Servs. § 4-501** — PAA (Public Assistance to Adults) statutes
- **Md. Code, Hum. Servs. § 5-5A-01** — MEAP (energy assistance) statutes
- **Md. Code, Hum. Servs. § 1-101** — General definitions and jurisdiction provisions
- **Md. Code, Educ. § 9.5-101** — Child care subsidy statutes
- **Md. Code, State Gov't § 10-1101** — Language access provisions
- **COMAR 07.03.17** — SNAP/Food Supplement Program regulations
- **COMAR 07.03.03** — TCA regulations
- **COMAR 07.03.24** — TDAP regulations
- **COMAR 07.03.05** — PAA regulations
- **COMAR 07.06.16** — MEAP/energy assistance regulations
- **COMAR 10.09.24** — Medical Assistance eligibility regulations
- **COMAR 13A.14** — Child care subsidy regulations
- **COMAR 07.01.01** — General DHS administrative regulations

## Maryland-Specific System Fields

The overlay adds five system fields used across Maryland programs:

| Field | Entity | Purpose |
|-------|--------|---------|
| `jurisdictionCode` | Household | Identifies which of the 24 jurisdictions (23 counties + Baltimore City) administers the case |
| `mdThinkCaseNumber` | Application | MD THINK platform case tracking number |
| `marylandResidencyVerified` | Household | Confirms Maryland residency for state-administered programs |
| `mdThinkClientId` | Person | MD THINK platform client identifier across all programs |
| `medicaidAidCategory` | Person | Determines Medical Assistance benefit set and funding source |

## Confidence and SME Review

This overlay represents a **first draft** compiled from publicly available Maryland statutes, regulations, and policy documents. It should be reviewed by Maryland-specific subject matter experts before use in production systems.

Areas that particularly benefit from SME review:
- MD THINK integration details and case/client ID formats
- MCHP eligibility boundaries and interaction with Maryland Medicaid (264% pregnant vs. 317% children)
- TCA county-level variation across 24 jurisdictions
- TDAP benefit levels, disability verification requirements, and interaction with SSI application process
- PAA eligibility criteria and benefit amounts
- CCS income thresholds (65% SMI) and co-payment calculation methodology
- EID (Employed Individuals with Disabilities) income limits and employment verification
- MEAP/OHEP crisis assistance criteria and benefit calculation
- Maryland state supplement to SSI amounts by living arrangement
- Language access requirements for DC metro area communities (Amharic, Mandarin, French, Haitian Creole, Korean)
- BBCE implementation details and interaction with other programs

## Future State Overlays

Additional states follow the same pattern in this directory:
- `{state}-benefits-overlay.csv` — State overlay CSV
- `{state}-benefits-overlay-guide.md` — Companion guide

Each state overlay uses the same column structure and OverlayAction semantics, with the number of columns varying by state based on the number of state-only programs.
