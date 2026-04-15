# CMS Federal Data Services Hub (FDSH)

FDSH is a CMS-hosted composite hub that bundles multiple federal verification queries into a single synchronous call. Used primarily for ACA/Medicaid eligibility determinations under 42 CFR § 435.940–965. Blueprint service type: `eligibility_hub`.

**Call mode:** Sync (returns within seconds to minutes; state adapters should configure timeout accordingly)

## Sub-services bundled in FDSH

| Sub-service | Source | Blueprint service type |
|---|---|---|
| Income verification | IRS | `income_verification` |
| SSA benefit income | SSA | `income_verification` |
| Citizenship verification | SSA | `identity_verification` |
| Immigration status | USCIS SAVE | `immigration_status` |
| Medicare enrollment | CMS | _(no standalone blueprint type)_ |
| Incarceration check | SSA Prison Verification | `incarceration_check` |

The FDSH result schema reuses component schemas from the standalone service type schemas (see [Decision 7](../architecture/domains/data-exchange.md#decision-7-result-payload-schemas-per-service-type)).

## Inputs

| Field | Required | Type | Notes |
|---|---|---|---|
| `name.firstName` | Yes | string | |
| `name.lastName` | Yes | string | |
| `dateOfBirth` | Yes | date | |
| `ssn` | Yes | string | |
| `programCode` | Yes | enum | `medicaid`, `chip`, `aca` |
| `stateCode` | Yes | string | 2-letter state code |
| `requestedVerifications` | Yes | object | Flags for which sub-services to invoke |
| `requestedVerifications.income` | | boolean | |
| `requestedVerifications.citizenship` | | boolean | |
| `requestedVerifications.immigration` | | boolean | |
| `requestedVerifications.medicare` | | boolean | |
| `requestedVerifications.incarceration` | | boolean | |
| `householdMembers` | No | array | Additional members to verify; same fields |

## Result fields

The FDSH response is a composite envelope containing a sub-result for each requested verification.

### Envelope fields

| Field | Type | Notes |
|---|---|---|
| `transactionId` | string | FDSH transaction reference |
| `overallMatchStatus` | enum | `completed`, `partial`, `failed` |
| `incomeResult` | object | Present if income verification was requested |
| `citizenshipResult` | object | Present if citizenship verification was requested |
| `immigrationResult` | object | Present if immigration verification was requested |
| `medicareResult` | object | Present if Medicare verification was requested |
| `incarcerationResult` | object | Present if incarceration check was requested |

### Income result

| Field | Type | Notes |
|---|---|---|
| `matchStatus` | enum | `matched`, `no_match`, `inconclusive`, `unavailable` |
| `sources` | array | One entry per contributing source (IRS, SSA) |
| `sources[].source` | enum | `irs`, `ssa` |
| `sources[].matchStatus` | enum | Per-source match status |
| `sources[].taxYear` | integer | Most recent tax year with data |
| `sources[].income` | number | Annual income reported |

### Citizenship result

| Field | Type | Notes |
|---|---|---|
| `matchStatus` | enum | `matched`, `no_match`, `inconclusive`, `unavailable` |
| `citizenshipStatus` | enum | `us_citizen`, `us_national`, `not_verified` |

### Immigration result

See [USCIS SAVE result fields](./uscis-save.md#result-fields). The FDSH immigration sub-result uses the same field structure.

### Medicare result

| Field | Type | Notes |
|---|---|---|
| `matchStatus` | enum | `matched`, `no_match`, `inconclusive`, `unavailable` |
| `enrollmentStatus` | enum | `enrolled`, `not_enrolled` |
| `partA` | boolean | |
| `partAEffectiveDate` | date | |
| `partB` | boolean | |
| `partBEffectiveDate` | date | |

### Incarceration result

See [SSA Prison Verification result fields](./ssa.md#prison-verification-system). Same field structure.

## Match status codes

Each sub-result carries its own `matchStatus`. The composite `overallMatchStatus` reflects whether all requested sub-results were returned:

| Code | Meaning |
|---|---|
| `completed` | All requested sub-services returned a result (may include inconclusive results) |
| `partial` | One or more sub-services were unavailable; others returned results |
| `failed` | FDSH could not process the request |

Partial results resolve to `completed` at the ExternalServiceCall level with `matchStatus: partial` — see [Decision 11](../architecture/domains/data-exchange.md#decision-11-partial-results-for-composite-calls). The calling domain (Eligibility) evaluates whether the available sub-results are sufficient to proceed.

## Regulatory and access notes

- FDSH is the primary verification hub for MAGI Medicaid real-time eligibility.
- Access is coordinated through the state Medicaid IT director or Health Insurance Exchange (HIX) coordinator.
- States using a State-Based Exchange (SBE) may access FDSH through a state HIX intermediary rather than directly.
- FDSH does not replace separate IEVS quarterly queries required for SNAP (7 CFR § 272.8) — those are separate batch calls.

> **Verification needed:** FDSH request format, sub-service flags, and composite response envelope field names should be confirmed against CMS FDSH integration documentation, available through the state Medicaid IT office or CMS's Health Insurance Oversight System (HIOS) team.
