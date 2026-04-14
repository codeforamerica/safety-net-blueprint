# USCIS SAVE — Immigration Status Verification

SAVE (Systematic Alien Verification for Entitlements) is a USCIS-administered system that state agencies use to verify immigration status for benefit eligibility. Required for SNAP (7 CFR § 272.8), Medicaid (42 CFR § 435.940–965), and TANF (42 U.S.C. § 1313). Blueprint service type: `immigration_status`.

**Call mode:** Sync (real-time; must complete before eligibility determination can proceed)

## Verification workflow

SAVE uses a multi-step process. Most cases resolve at step 1. Steps 2 and 3 are exception paths handled through the Workflow domain (verification tasks, RFI).

| Step | Trigger | Who acts |
|---|---|---|
| 1 — Initial verification | Intake submission | Data Exchange (automated) |
| 2 — Additional verification | `inconclusive` or `not_verified` result from step 1 | Caseworker corrects/supplements data; resubmits |
| 3 — Documentary evidence | Step 2 still inconclusive | RFI issued; applicant provides documents (10-day deadline) |
| Manual adjudication | Documents received | Caseworker compares to USCIS response; approves or denies |

Steps 2 and 3 live in the Workflow domain as verification tasks — not in Data Exchange.

## Inputs

### Initial verification request

| Field | Required | Type | Notes |
|---|---|---|---|
| `name.firstName` | Yes | string | |
| `name.lastName` | Yes | string | |
| `dateOfBirth` | Yes | date | |
| `ssn` | Yes | string | 9-digit SSN |
| `address.line1` | Yes | string | |
| `address.city` | Yes | string | |
| `address.state` | Yes | string | 2-letter code |
| `address.postalCode` | Yes | string | |
| `documentType` | Conditional | enum | Required if applicant has immigration documents |
| `documentNumber` | Conditional | string | A-number, I-94 number, etc. |
| `documentExpirationDate` | Conditional | date | |

### Document types accepted as input

| Code | Document |
|---|---|
| `green_card` | Permanent Resident Card (A-number required) |
| `ead` | Employment Authorization Document |
| `i94` | Arrival/Departure Record |
| `visa` | Non-immigrant visa |
| `passport` | Passport |
| `advance_parole` | Advance Parole (I-131 approval) |
| `refugee_travel_doc` | Refugee Travel Document |
| `naturalization_cert` | Certificate of Naturalization |
| `crba` | Consular Report of Birth Abroad |

## Result fields

| Field | Type | Notes |
|---|---|---|
| `caseNumber` | string | SAVE case number for this verification |
| `verificationDate` | datetime | When USCIS performed the check |
| `matchStatus` | enum | See match status codes below |
| `immigrationStatus` | enum | See immigration status codes below |
| `statusDescription` | string | Human-readable description |
| `countryOfBirth` | string | |
| `documentType` | string | Document type matched in USCIS records |
| `documentNumber` | string | Matched document number |
| `documentExpirationDate` | date | |
| `verificationLevel` | enum | `primary`, `secondary`, `manual_review` |
| `nameMatch` | boolean | Whether submitted name matched USCIS records |
| `dateOfBirthMatch` | boolean | |
| `additionalVerificationRequired` | boolean | Whether step 2 is needed |
| `referralDate` | date | Deadline for applicant response if RFI issued |

## Match status codes

| Code | Meaning | Next action |
|---|---|---|
| `verified` | Immigration status confirmed; eligible basis met | Proceed to eligibility determination |
| `not_verified` | No match in USCIS database | RFI or caseworker manual review |
| `inconclusive` | Partial match; key field discrepancy | Step 2 additional verification |
| `pending_manual_review` | Documents submitted; awaiting adjudication | Await caseworker decision |
| `closed_case` | Case previously approved but now closed or expired | Manual review; likely ineligible |
| `fraud_suspected` | System flagged inconsistencies | Escalate to DHS; deny pending clearance |

## Immigration status codes

| Code | Status | Benefit eligibility (general) |
|---|---|---|
| `lpr` | Lawful Permanent Resident | Eligible (5-year bar may apply) |
| `refugee` | Refugee | Eligible for 7 years from admission |
| `asylee` | Asylee | Eligible for 7 years from grant |
| `ti_victim` | Trafficking victim (T visa) | Eligible |
| `u_visa` | Crime victim (U visa) | Eligible if approved |
| `vawa` | VAWA self-petitioner | Eligible |
| `paroled` | Paroled into U.S. | Eligible within 7-year window |
| `conditional_resident` | Conditional Resident (2-year GC) | Eligible (same as LPR) |
| `daca` | Deferred Action for Childhood Arrivals | Ineligible for federal benefits; state rules vary |
| `tps` | Temporary Protected Status | Varies by program and state |
| `nonimmigrant` | Non-immigrant visa holder (H-1B, F-1, etc.) | Ineligible for federal SNAP/TANF; emergency Medicaid only |
| `unauthorized` | No lawful status | Ineligible for federal benefits |
| `case_closed` | Status expired or case closed | Manual review; case-by-case |

## Regulatory and access notes

- U.S. citizens do not require a SAVE query — citizenship is verified separately (typically via SSA).
- SAVE is accessed via USCIS-hosted endpoints; states configure endpoint URL in `data-exchange-config.yaml`.
- Data matching requires a Computer Matching Agreement (5 U.S.C. § 552a).
- Existing schema references: `ImmigrationInfo` in `persons-openapi.yaml` captures document fields; `CitizenshipInfo` captures citizenship status — result schema should align with these.

## Access and documentation

**The SAVE API technical specification (the Integration Control Agreement, or ICA) is gated to registered agencies.** It is not publicly available — agencies must have an active SAVE agreement with USCIS and log into the SAVE portal to download it.

Current version: **ICA v38** (in beta as of early 2026). Key changes in v38:
- Migration from legacy SOAP to REST API architecture
- New initial response structure for immigration status and employment authorization
- Aligns web service responses with manual verification responses

The field names in this doc reflect the SAVE process as described in publicly available USCIS program documentation. The exact REST field names, response envelope structure, and USCIS-specific status codes are in the ICA.

To obtain the authoritative field specification:
- Contact your **state SAVE program coordinator** — registered agencies can access the ICA v38 beta directly from the SAVE portal
- Email **SAVE.help@uscis.dhs.gov** for integration support
- Note: if your state is currently on a SOAP integration, plan for the REST migration in v38
