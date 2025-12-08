# OpenAPI Validation Guide

Comprehensive guide for validating OpenAPI specifications and examples.

## Overview

The validation utility ensures your OpenAPI specifications and examples are correct, consistent, and production-ready. It validates:

- **OpenAPI Specifications** - Syntax, structure, and reference resolution
- **Examples** - Schema compliance and data integrity

## Quick Start

```bash
# Detailed output (default) - shows all errors with specific property names
npm run validate

# Brief output - shows first 3 errors per example
npm run validate -- --brief

# Show help
npm run validate -- --help
```

**Options:**
- `-d, --detailed` - Show all validation errors with property paths (default)
- `-b, --brief` - Show only first 3 errors per example
- `-h, --help` - Show help message

**Exit codes:**
- `0` - Success (all validations passed)
- `1` - Failure (validation errors found)

## Understanding Validation Output

The validator shows **specific property paths** for each error:

```bash
- PersonExample1: name must NOT have additional property 'name.suffix'
  address must NOT have additional property 'address.country'
```

**Reading error messages:**
- Property path shows exactly where the issue is (e.g., `name.suffix`, `address.country`)
- Error types:
  - `must NOT have additional property 'X'` - Property exists but isn't defined in schema
  - `must have required property 'X'` - Required property is missing
  - `must be {type}` - Wrong data type (e.g., string instead of number)
  - `{message} (allowed: A, B, C)` - Invalid enum value

## What Gets Validated

### OpenAPI Specifications

For each `.yaml` file in `/openapi/`:
- ✓ File exists and is parseable
- ✓ Valid OpenAPI 3.x format
- ✓ Required fields present (`info`, `paths`)
- ✓ All `$ref` references can be resolved
- ✓ No circular references

### Examples

For each `.yaml` file in `/openapi/examples/`:
- ✓ File exists and is parseable (optional)
- ✓ Examples match their schemas
- ✓ Required properties are present
- ✓ No additional properties (when restricted)
- ✓ Correct data types and formats
- ✓ Enum values are valid

## Automatic Validation

Validation runs automatically during:

```bash
npm run mock:setup        # Validates before seeding databases
npm run clients:generate          # Validates before generating clients
npm run postman:generate  # Validates before generating collection
```

### Skipping Validation

When needed, you can skip automatic validation:

```bash
# Environment variable
SKIP_VALIDATION=true npm run mock:setup

# Programmatically
import { performSetup } from './src/mock-server/setup.js';
await performSetup({ skipValidation: true });
```

## Understanding Validation Output

### Successful Validation

```
======================================================================
Validation Summary:
======================================================================
  Total APIs: 3
  Valid: 3
  Invalid: 0
  Total Errors: 0
  Total Warnings: 0

  ✓ applications
  ✓ households
  ✓ persons

✓ All validations passed!
```

### Validation with Warnings

```
  ✓ applications
    1 warning(s)

⚠️  Validation passed with warnings
```

Warnings indicate non-critical issues that don't prevent operation.

### Validation Errors

**Detailed mode (default)** shows all errors with specific property paths:

```
  ✗ applications
    Examples: 8 error(s)
      - ApplicationExample1: applicantInfo.signature.applicantSignature must have required property 'applicantInfo.signature.applicantSignature.signature'
        applicantInfo.signature.applicantSignature must have required property 'applicantInfo.signature.applicantSignature.signatureDate'
        applicantInfo.signature.applicantSignature must NOT have additional property 'applicantInfo.signature.applicantSignature.signedBy'
        applicantInfo.homeAddress must NOT have additional property 'applicantInfo.homeAddress.country'
      - ApplicationExample2: applicantInfo.homeAddress must NOT have additional property 'applicantInfo.homeAddress.country'

❌ Validation failed with errors
```

**Brief mode** (`--brief`) shows first 3 errors per example:

```
  ✗ applications
    Examples: 8 error(s)
      - ApplicationExample1: applicantInfo.signature must have required property 'signature'
        ... and 3 more error(s) in this example
      - ApplicationExample2: homeAddress must NOT have additional property 'country'
```

## Common Validation Errors

### 1. Additional Properties

```
Error: homeAddress must NOT have additional property 'homeAddress.country'
```

**Cause:** Example contains properties not defined in the schema (e.g., `country` field not in Address schema).

**Fix:**
```yaml
# Schema has additionalProperties: false
# Remove extra properties from example OR add them to schema

# Option 1: Update example
homeAddress:
  street: "123 Main St"
  city: "Springfield"
  # Remove: extraField: "value"

# Option 2: Update schema (if property should be allowed)
properties:
  homeAddress:
    type: object
    properties:
      street:
        type: string
      city:
        type: string
      extraField:  # Add missing property
        type: string
```

### 2. Missing Required Properties

```
Error: applicantInfo.signature.applicantSignature must have required property 'applicantInfo.signature.applicantSignature.signature'
```

**Cause:** Example is missing a required field (e.g., `signature` field is required but not present).

**Fix:**
```yaml
# Add the required field to your example
applicantSignature:
  signature: "John Doe"        # Add missing field
  signedAt: "2024-01-15T10:00:00Z"
```

### 3. Type Mismatch

```
Error: price must be number
```

**Cause:** Value type doesn't match schema.

**Fix:**
```yaml
# Wrong
price: "99.99"  # String

# Correct
price: 99.99    # Number
```

### 4. Format Errors

```
Error: email must match format "email"
```

**Cause:** Value doesn't match expected format.

**Fix:**
```yaml
# Wrong
email: "not-an-email"

# Correct
email: "user@example.com"
```

### 5. Enum Violations

```
Error: status must be one of: pending, approved, rejected
```

**Cause:** Value not in allowed enum values.

**Fix:**
```yaml
# Wrong
status: "unknown"

# Correct
status: "pending"  # Must be one of the enum values
```

## Programmatic Usage

### Validate Single Specification

```javascript
import { validateSpec } from './src/mock-server/openapi-validator.js';

const result = await validateSpec('./openapi/products.yaml');

console.log(result.valid);      // true or false
console.log(result.errors);     // Array of error objects
console.log(result.warnings);   // Array of warning objects
```

### Validate Examples

```javascript
import { validateExamples } from './src/mock-server/openapi-validator.js';

const result = await validateExamples(
  './openapi/products.yaml',
  './openapi/examples/products.yaml'
);

if (!result.valid) {
  result.errors.forEach(error => {
    console.error(`${error.example}: ${error.field} ${error.message}`);
  });
}
```

### Validate All APIs

```javascript
import { validateAll } from './src/mock-server/openapi-validator.js';
import { discoverApiSpecs } from './src/mock-server/openapi-loader.js';

const specs = discoverApiSpecs().map(spec => ({
  ...spec,
  examplesPath: `./openapi/examples/${spec.name}.yaml`
}));

const results = await validateAll(specs);

for (const [apiName, result] of Object.entries(results)) {
  console.log(`${apiName}: ${result.valid ? 'VALID' : 'INVALID'}`);
}
```

### Error Object Structure

```javascript
{
  type: 'validation',           // Error type
  path: '/path/to/file.yaml',  // File path
  example: 'ProductExample1',   // Example name (for example errors)
  field: 'price',               // Field with error
  message: 'must be number',    // Error message
  details: {...}                // Raw AJV error object
}
```

## CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/validate.yml
name: Validate OpenAPI

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run validate
```

### Pre-commit Hook

```bash
# Using husky
npm install --save-dev husky

# Add to package.json
{
  "scripts": {
    "prepare": "husky install"
  }
}

# Create pre-commit hook
npx husky add .husky/pre-commit "npm run validate"
```

### GitLab CI

```yaml
# .gitlab-ci.yml
validate:
  stage: test
  image: node:18
  script:
    - npm install
    - npm run validate
```

### Validating Generated Files in CI

Ensure generated files are up-to-date in CI/CD:

```bash
# Regenerate and check for differences
npm run validate
npm run clients:generate
npm run postman:generate

# Fail if files are out of sync
git diff --exit-code generated/clients/ generated/postman-collection.json
```

**GitHub Actions Example:**
```yaml
- name: Validate specs and generated files
  run: |
    npm run validate
    npm run clients:generate
    npm run postman:generate
    git diff --exit-code generated/clients/ generated/postman-collection.json
```

This prevents merging changes when:
- OpenAPI specs are modified but generated files weren't updated
- Generated files are manually edited instead of regenerated
- Specs and generated files are out of sync

## Best Practices

### 1. Run Validation Early

```bash
# Before committing
npm run validate

# Before generating clients/collections
npm run validate && npm run clients:generate
```

### 2. Keep Examples Synchronized

When updating schemas:
1. Update the OpenAPI specification
2. Update corresponding examples
3. Run validation to verify
4. Fix any errors before committing

### 3. Use Validation in Development

```bash
# Development workflow
npm run validate              # Check for errors
npm run mock:setup            # Will validate automatically
npm run mock:start            # Start server
```

### 4. Document Complex Schemas

Add descriptions to help fix validation errors:

```yaml
properties:
  status:
    type: string
    enum: [pending, approved, rejected]
    description: "Application status. Must be one of: pending, approved, rejected"
```

### 5. Handle Validation in Code

```javascript
import { validateSpec } from './src/mock-server/openapi-validator.js';

async function safelyLoadSpec(path) {
  const validation = await validateSpec(path);
  
  if (!validation.valid) {
    console.error('Validation errors:');
    validation.errors.forEach(err => console.error(`  - ${err.message}`));
    throw new Error('Invalid specification');
  }
  
  // Continue with loading...
}
```

## Troubleshooting

### Validation Too Strict

**Issue:** `additionalProperties: false` is too restrictive

**Solution:**
```yaml
# Make schema more permissive
MySchema:
  type: object
  additionalProperties: true  # Allow additional properties
  # OR
  additionalProperties:
    type: string              # Allow string properties
```

### Cannot Find Schema

**Issue:** "Could not identify main resource schema"

**Solution:**
- Ensure schema name matches resource (e.g., `Person` for `persons` API)
- Define schema in `components.schemas`
- Check schema naming conventions

### Reference Resolution Fails

**Issue:** "Failed to resolve $refs"

**Solution:**
- Verify all `$ref` paths are correct
- Check referenced files exist
- Use relative paths from spec file location

### Examples Don't Match Reality

**Issue:** Examples are outdated

**Solution:**
1. Update examples to match current schema
2. Run validation to verify
3. Update documentation if needed
4. Commit both spec and example changes together

## Technical Details

### Validation Implementation

The validation utility uses:
- **[@apidevtools/json-schema-ref-parser](https://www.npmjs.com/package/@apidevtools/json-schema-ref-parser)** - Resolve `$ref` references
- **[AJV](https://ajv.js.org/)** - JSON Schema validation
- **[ajv-formats](https://www.npmjs.com/package/ajv-formats)** - Format validators (email, uuid, date, etc.)

### Files

- `src/mock-server/openapi-validator.js` - Core validation module
- `scripts/validate-openapi.js` - Standalone validation script
- Integration in:
  - `src/mock-server/setup.js`
  - `scripts/generate-clients.js`
  - `scripts/generate-postman.js`

### Performance

Validation is fast:
- Small specs (<100 KB): ~100ms
- Medium specs (<500 KB): ~500ms
- Large specs (<2 MB): ~2s

For multiple APIs, validation runs in sequence but typically completes in under 5 seconds.

## Examples

### Full Validation Workflow

```bash
# 1. Make changes to spec
vim openapi/products.yaml

# 2. Update examples
vim openapi/examples/products.yaml

# 3. Validate changes
npm run validate

# 4. Fix any errors
# ... edit files based on error messages ...

# 5. Validate again
npm run validate

# 6. Generate artifacts
npm run clients:generate
npm run postman:generate

# 7. Test
npm run mock:reset
npm run mock:start
npm test
```

### Validation in Tests

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateSpec } from './src/mock-server/openapi-validator.js';

describe('OpenAPI Specifications', () => {
  it('should have valid applications spec', async () => {
    const result = await validateSpec('./openapi/applications.yaml');
    assert.strictEqual(result.valid, true);
  });
  
  it('should have valid examples', async () => {
    const result = await validateExamples(
      './openapi/applications.yaml',
      './openapi/examples/applications.yaml'
    );
    assert.strictEqual(result.valid, true);
  });
});
```

## Related Documentation

- [Developer Guide](./README_DEVELOPER.md) - Adding and updating APIs
- [Mock Server Guide](./README_MOCK_SERVER.md) - Using validated specs
- [API Client Generator](./README_API_CLIENTS.md) - Generating from valid specs
- [Testing Guide](./README_TESTING.md) - Testing validated APIs

## Support

If validation errors are unclear:
1. Run `npm run validate` for detailed output
2. Check this guide for common error solutions
3. Review the [OpenAPI 3.1 specification](https://spec.openapis.org/oas/v3.1.0)
4. Validate manually at [editor.swagger.io](https://editor.swagger.io)
