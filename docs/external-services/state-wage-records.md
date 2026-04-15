# State Wage Records and NDNH

State agencies verify employment income using two complementary sources: state unemployment insurance (UI) wage records and the National Directory of New Hires (NDNH). Both map to blueprint service type `income_verification`.

---

## State UI Wage Records

State labor/UI agencies maintain quarterly wage records submitted by employers. These are the most detailed income source for active and recent employment.

**Call mode:** Async (batch submission common; real-time API queries available in some states)

### Inputs

| Field | Required | Type | Notes |
|---|---|---|---|
| `ssn` | Yes | string | Primary identifier |
| `firstName` | Yes | string | |
| `lastName` | Yes | string | |
| `dateOfBirth` | No | date | Helps resolve ambiguous SSN matches |
| `queryYears` | No | array[integer] | Years to retrieve; defaults to current year and prior 2 |

### Result fields

| Field | Type | Notes |
|---|---|---|
| `matchStatus` | enum | See status codes below |
| `yearResults` | array | One entry per calendar year |
| `yearResults[].year` | integer | |
| `yearResults[].annualWages` | number | Sum of all quarters |
| `yearResults[].quarterResults` | array | |
| `yearResults[].quarterResults[].quarter` | integer | 1–4 |
| `yearResults[].quarterResults[].employerName` | string | |
| `yearResults[].quarterResults[].employerAccountNumber` | string | State UI account number |
| `yearResults[].quarterResults[].wagesReported` | number | Wages for this quarter |
| `yearResults[].quarterResults[].employerPhone` | string | May be returned for contact follow-up |

### Match status codes

| Code | Meaning |
|---|---|
| `matched` | Record found; wage data returned |
| `no_match` | No wage record for this SSN |
| `inconclusive` | Partial identifier match |

### Notes

- Coverage gap: wages are typically reported quarterly with a 1–2 quarter lag. Recent income may not yet appear.
- Interstate employment: wages earned in another state appear only in that state's records — use NDNH for multi-state coverage.
- Wage records are matched by SSN; name and DOB help disambiguate but are not always validated by the UI agency.

---

## National Directory of New Hires (NDNH)

A federal repository operated by DHHS Office of Child Support Enforcement (OCSE) that collects new hire filings from all employers within 20 days of hire. Enables real-time recent employment detection and multi-state coverage.

**Call mode:** Sync (real-time API; typically 1–5 second response)

### Inputs

| Field | Required | Type | Notes |
|---|---|---|---|
| `ssn` | Yes | string | |
| `firstName` | Yes | string | |
| `lastName` | Yes | string | |
| `stateFilter` | No | string | Limit results to a specific state |

### Result fields

| Field | Type | Notes |
|---|---|---|
| `matchStatus` | enum | See status codes below |
| `newHireRecords` | array | One entry per new hire filing |
| `newHireRecords[].hiringDate` | date | Date of hire as reported by employer |
| `newHireRecords[].employerName` | string | |
| `newHireRecords[].employerEin` | string | Employer Identification Number |
| `newHireRecords[].employerState` | string | State where employer is located |
| `newHireRecords[].reportedDate` | date | When employer submitted the new hire notice |
| `noHiresFoundSince` | date | Earliest date checked if no records returned |

### Match status codes

Same as wage records: `matched`, `no_match`, `inconclusive`.

---

## IEVS and these services

Both state wage records and NDNH data flow through the IEVS framework (7 CFR § 272.8):

- SNAP requires quarterly IEVS checks for all active cases — typically batch.
- Discrepancies between returned wages and client-reported income trigger a verification workflow: request documents, contact employer, or update the determination.
- All matching activity must be logged per Computer Matching Agreement requirements (5 U.S.C. § 552a).

In the blueprint, each query is a separate ExternalServiceCall. The Eligibility domain's rules initiate IEVS calls and subscribe to result events — see [Decision 6](../architecture/domains/data-exchange.md#decision-6-calling-domains-own-subscription-logic).

## Access notes

- State wage record access: coordinated through the state Department of Labor or UI agency. Requires a data exchange agreement.
- NDNH access: coordinated through the state child support enforcement office or Medicaid IT director. Requires DHHS/OCSE agreement.
- Interstate queries: NDNH handles multi-state coverage automatically; no agency-to-agency coordination needed.
- Batch vs. real-time: state configures `defaultCallMode` in `data-exchange-config.yaml`; can be overridden per call.

> **Verification needed:** Response field names for state wage records vary by state UI agency. The fields above reflect common practice but may differ. NDNH field names should be confirmed against OCSE technical documentation (available to registered agencies).
