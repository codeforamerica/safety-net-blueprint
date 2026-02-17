# ADR: OpenAPI to JSON Schema Conversion Approach

**Status:** Accepted

**Date:** 2026-02-12

**Deciders:** Development Team

---

## Context

The toolkit needs to produce standalone JSON Schema files from OpenAPI specifications for use in form validation, code generation, and documentation tooling. This means extracting `components.schemas` from each OpenAPI spec and outputting them as individual `.json` files.

Two problems need solving:

1. **Conversion:** Transform OpenAPI 3.1 schema objects into valid standalone JSON Schema.
2. **Reference resolution:** OpenAPI specs use `$ref` to compose schemas across files. Output files must be self-contained.

---

## Decision

### Conversion: Custom code, not a library

We wrote a small custom converter (`generate-clients-json-schema.js`) rather than adopting a library.

OpenAPI 3.1 intentionally aligned its schema object model with JSON Schema Draft 2020-12. The schemas are already JSON Schema — the only difference is a handful of OpenAPI-specific keywords (`discriminator`, `xml`, `externalDocs`, `example`, `deprecated`, `x-*` extensions) that need to be stripped, plus adding `$schema` and `$id` metadata.

Libraries for this conversion largely don't exist because there's so little to do. The ones that do exist tend to target older OpenAPI versions (3.0 and earlier) where the gap between OpenAPI's schema dialect and JSON Schema was much wider. For 3.1, the conversion is trivially a keyword-stripping pass over the extracted schemas.

### Reference resolution: `@apidevtools/json-schema-ref-parser`

We use `$RefParser.dereference()` to resolve all `$ref` entries (both internal like `#/components/schemas/DemographicInfo` and external like `./components/contact.yaml#/PhoneNumber`) before extracting schemas. This produces fully inlined, self-contained output.

This library was already a project dependency used by `openapi-loader.js` for the same purpose. We follow the same pattern with `circular: 'ignore'`.

---

## Options Considered

### Conversion approach

| Option | Assessment |
|--------|-----------|
| **Custom keyword stripping (chosen)** | ~15 lines of code. Strips the known set of OpenAPI-only keywords and adds JSON Schema metadata. Easy to maintain and extend. |
| **Dedicated library** | No mature library targets OpenAPI 3.1 → JSON Schema specifically, because the specs are nearly identical by design. Libraries like `openapi-schema-to-json-schema` target OpenAPI 3.0's `nullable`, `exclusiveMinimum` (boolean form), and other differences that don't exist in 3.1. |

### Dereferencing approach

| Option | Assessment |
|--------|-----------|
| **`$RefParser.dereference()` — full inlining (chosen)** | Already a dependency. Resolves all refs. Output files stand alone. Trade-off: shared schemas are duplicated (larger files). |
| **`$RefParser.bundle()` — preserve internal refs** | Smaller output, but consumers must resolve internal `$ref`s themselves. Defeats the purpose of standalone files. |
| **`swagger-cli bundle --dereference`** | Proven on an earlier branch, but adds a dependency and requires shelling out. No advantage over using the library we already have. |

---

## Consequences

### Positive

- Output JSON Schema files are fully self-contained — no `$ref` resolution required by consumers
- No new dependencies
- Custom conversion code is small and obvious — easy to audit and extend if OpenAPI adds new keywords
- Consistent with existing project patterns (`openapi-loader.js`)

### Negative

- Output files are larger due to schema duplication (e.g., `Address` inlined everywhere it's referenced)
- The keyword stripping list is manually maintained — if OpenAPI introduces new non-JSON-Schema keywords, they must be added explicitly

### If we need to revisit

- If file size becomes a concern, `$RefParser.bundle()` is a single-line swap that preserves internal `$ref`s while resolving external ones.
- If a credible OpenAPI 3.1 → JSON Schema library emerges, the custom code is small enough to replace without friction.

---

## References

- [OpenAPI 3.1 and JSON Schema alignment](https://www.openapis.org/blog/2021/02/18/openapi-specification-3-1-released) — OAI blog post on the 3.1 alignment with JSON Schema Draft 2020-12
- `packages/contracts/src/validation/openapi-loader.js` — existing `$RefParser.dereference()` usage in this project
- `packages/clients/scripts/generate-clients-json-schema.js` — the converter implementation
