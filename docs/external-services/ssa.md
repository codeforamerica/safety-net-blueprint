# SSA Verification Services

SSA provides income verification, identity verification, death records, and incarceration data used by SNAP, Medicaid, and TANF. Multiple services map to different blueprint service types.

## Services

### BENDEX — Beneficiary and Earnings Data Exchange

Provides SSA benefit payment amounts and Medicare entitlement status for active cases. Used primarily for income verification.

**Blueprint service type:** `income_verification`  
**Call mode:** Sync (real-time)

**Inputs:**

| Field | Type | Notes |
|---|---|---|
| `ssn` | string | Primary identifier |
| `firstName` | string | |
| `lastName` | string | |
| `dateOfBirth` | date | |

**Result fields:**

| Field | Type | Notes |
|---|---|---|
| `matchStatus` | enum | See status codes below |
| `benefitType` | enum | `retirement`, `survivor`, `disability` (SSDI), `ssi` |
| `monthlyBenefitAmount` | number | Current monthly gross benefit |
| `benefitStatus` | enum | `active`, `suspended`, `terminated` |
| `medicareEntitlement` | object | |
| `medicareEntitlement.partA` | boolean | |
| `medicareEntitlement.partAEffectiveDate` | date | |
| `medicareEntitlement.partB` | boolean | |
| `medicareEntitlement.partBEffectiveDate` | date | |

---

### SVES — State Verification and Exchange System

Provides similar data to BENDEX but designed for batch queries and includes more detailed work history. Some states use SVES instead of or alongside BENDEX.

**Blueprint service type:** `income_verification`  
**Call mode:** Sync or async (batch-capable)

**Result fields (beyond BENDEX):**

| Field | Type | Notes |
|---|---|---|
| `awardDate` | date | When benefit was first awarded |
| `terminationDate` | date | When benefit ended (if terminated) |
| `earningsRecords` | array | Employment and wage history |
| `earningsRecords[].employerName` | string | |
| `earningsRecords[].wages` | number | |
| `earningsRecords[].year` | integer | |

---

### IEVS / EVS — Earnings Verification

SSA earnings records available through the IEVS channel. Returns earned income history.

**Blueprint service type:** `income_verification`  
**Call mode:** Async (batch)

**Inputs:** Same as BENDEX.

**Result fields:**

| Field | Type | Notes |
|---|---|---|
| `matchStatus` | enum | See status codes below |
| `earningsRecords` | array | |
| `earningsRecords[].year` | integer | |
| `earningsRecords[].grossEarnings` | number | |
| `earningsRecords[].employerName` | string | |
| `earningsRecords[].employerEin` | string | |

---

### Prison Verification System

Used to check whether a person is currently incarcerated, which disqualifies them from most SNAP and TANF benefits.

**Blueprint service type:** `incarceration_check`  
**Call mode:** Sync

**Inputs:** Same as BENDEX.

**Result fields:**

| Field | Type | Notes |
|---|---|---|
| `matchStatus` | enum | See status codes below |
| `incarcerationStatus` | enum | `incarcerated`, `not_incarcerated`, `unable_to_determine` |
| `facilityType` | enum | `federal_prison`, `state_prison`, `county_jail` — present if incarcerated |
| `incarcerationDate` | date | Date custody began — if available |
| `expectedReleaseDate` | date | If available |

**Match status codes (incarceration):**

| Code | Meaning |
|---|---|
| `incarcerated` | Confirmed in custody; disqualifies SNAP/TANF benefits |
| `not_incarcerated` | Confirmed not in custody |
| `unable_to_determine` | Inconclusive; may warrant manual review |

---

### Death Master File (DMF)

Verifies whether a person is deceased. Required for all Medicaid applicants (42 CFR § 435.952).

**Blueprint service type:** `identity_verification` (or handled as part of `eligibility_hub`)  
**Call mode:** Sync

**Inputs:** Same as BENDEX.

**Result fields:**

| Field | Type | Notes |
|---|---|---|
| `matchStatus` | enum | See status codes below |
| `dateOfDeath` | date | Present if deceased |
| `stateOfDeath` | string | State where death was registered |

**Match status codes (DMF):**

| Code | Meaning |
|---|---|
| `deceased` | Confirmed deceased; triggers benefit termination |
| `not_deceased` | Confirmed living |
| `ambiguous` | Multiple potential matches; requires manual review |

---

### Identity Verification

Confirms that a submitted name and SSN match SSA records. Used at intake for initial identity confirmation.

**Blueprint service type:** `identity_verification`  
**Call mode:** Sync

**Inputs:** Same as BENDEX, optionally including current address.

**Result fields:**

| Field | Type | Notes |
|---|---|---|
| `matchStatus` | enum | See status codes below |
| `matchDetail` | enum | `exact`, `partial`, `none` |
| `ssnIssued` | boolean | Whether the SSN was ever issued |

**Match status codes (identity):**

| Code | Meaning |
|---|---|
| `matched` | SSN and name confirmed in SSA records |
| `not_matched` | Data does not match SSA records |
| `inconclusive` | Partial match; manual review needed |
| `ssn_not_issued` | SSN was never issued; potential fraud indicator |
| `name_mismatch` | SSN valid but name differs from SSA record |
| `dob_mismatch` | SSN valid but DOB differs from SSA record |

---

## Common match status codes (income services)

| Code | Meaning |
|---|---|
| `matched` | All identifiers matched; data returned |
| `no_match` | No record found |
| `inconclusive` | Partial identifier match; possible discrepancy |
| `pending_manual_review` | Match flagged for caseworker adjudication |

## Regulatory and access notes

- BENDEX and SVES access requires a data exchange agreement with SSA.
- Income data accessed via SSA falls under IEVS requirements (7 CFR § 272.8).
- Death Master File check is required for Medicaid (42 CFR § 435.952).
- Prison Verification: SNAP disqualification at 7 CFR § 272.8; TANF at 45 CFR § 265.1.

> **Verification needed:** BENDEX vs. SVES availability varies by state agreement. Confirm which service(s) your state accesses and the exact response field names with your SSA liaison.
