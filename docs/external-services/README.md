# External Services Reference

Reference documentation for the government and federal agency APIs that states connect to through the [Data Exchange domain](../architecture/domains/data-exchange.md).

These docs capture what each service provides, what inputs it takes, and what result fields it returns — enough to design the OpenAPI schemas for the `income_verification`, `identity_verification`, `immigration_status`, `eligibility_hub`, and `incarceration_check` service types.

## Services

| File | Agency | Blueprint service type(s) |
|---|---|---|
| [irs.md](./irs.md) | IRS | `income_verification` |
| [ssa.md](./ssa.md) | SSA | `income_verification`, `identity_verification`, `incarceration_check` |
| [uscis-save.md](./uscis-save.md) | USCIS | `immigration_status` |
| [cms-fdsh.md](./cms-fdsh.md) | CMS | `eligibility_hub` (composite) |
| [state-wage-records.md](./state-wage-records.md) | State UI / OCSE | `income_verification` |

## Notes

- Field names marked **"Verification needed"** in each doc are derived from publicly available regulatory and program documentation and should be confirmed against official integration guides before finalizing schemas.
- Credentials, endpoint URLs, and Computer Matching Agreement details are out of scope — see [data-exchange.md Out of scope](../architecture/domains/data-exchange.md#out-of-scope).
