# CI/CD for Backend

This guide covers validating API specifications in CI and contract testing your backend implementation against the spec.

## Validating Specifications

### GitHub Actions

```yaml
# .github/workflows/validate.yml
name: Validate API Specs

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Validate base specs
        run: npm run validate

      - name: Validate all state specs
        run: npm run validate:all-states
```

### GitLab CI

```yaml
# .gitlab-ci.yml
validate:
  image: node:20
  script:
    - npm install
    - npm run validate
    - npm run validate:all-states
```

## Contract Testing Your Backend

Once you've built a backend that implements the Safety Net API spec, use the generated Postman collection to verify your implementation conforms to the specification.

### Option 1: Generate Collection in CI

Clone the toolkit and generate the collection as part of your CI pipeline:

```yaml
# .github/workflows/contract-tests.yml
name: Contract Tests

on: [push, pull_request]

jobs:
  contract-tests:
    runs-on: ubuntu-latest

    services:
      # If your backend needs a database
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - name: Checkout backend
        uses: actions/checkout@v4

      - name: Start backend
        run: |
          # Start your backend server
          docker-compose up -d
          # Or: npm start &

          # Wait for it to be ready
          sleep 10
          curl --retry 10 --retry-delay 2 http://localhost:8080/health

      - name: Checkout Safety Net OpenAPI toolkit
        uses: actions/checkout@v4
        with:
          repository: codeforamerica/safety-net-openapi
          path: openapi-toolkit

      - name: Generate Postman collection
        working-directory: openapi-toolkit
        run: |
          npm install
          STATE=<your-state> npm run postman:generate

      - name: Run contract tests
        run: |
          npx newman run openapi-toolkit/generated/postman-collection.json \
            --env-var "baseUrl=http://localhost:8080" \
            --reporters cli,junit \
            --reporter-junit-export results.xml

      - name: Upload test results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: contract-test-results
          path: results.xml

      - name: Publish test results
        uses: dorny/test-reporter@v1
        if: always()
        with:
          name: Contract Tests
          path: results.xml
          reporter: java-junit
```

### Option 2: Pre-generate Collection

If you prefer not to clone the toolkit in CI, generate the collection locally and commit it to your backend repository:

```bash
# In the safety-net-openapi toolkit
STATE=<your-state> npm run postman:generate

# Copy to your backend repo
cp generated/postman-collection.json ../your-backend/tests/contract/
```

Then your CI simplifies to:

```yaml
- name: Run contract tests
  run: |
    npx newman run tests/contract/postman-collection.json \
      --env-var "baseUrl=http://localhost:8080"
```

**Trade-offs:**

| Approach | Pros | Cons |
|----------|------|------|
| Generate in CI | Always uses latest spec | Slower CI, requires toolkit clone |
| Pre-generate | Faster CI | Must manually update when spec changes |

### Option 3: Hybrid Approach

Check for spec changes and regenerate only when needed:

```yaml
- name: Check if spec changed
  id: spec-check
  run: |
    # Compare spec version or hash
    CURRENT_HASH=$(cat tests/contract/.spec-hash 2>/dev/null || echo "none")
    git clone --depth 1 https://github.com/codeforamerica/safety-net-openapi.git
    NEW_HASH=$(cd safety-net-openapi && git rev-parse HEAD)
    echo "current=$CURRENT_HASH" >> $GITHUB_OUTPUT
    echo "new=$NEW_HASH" >> $GITHUB_OUTPUT

- name: Regenerate collection
  if: steps.spec-check.outputs.current != steps.spec-check.outputs.new
  run: |
    cd safety-net-openapi
    npm install
    STATE=<your-state> npm run postman:generate
    cp generated/postman-collection.json ../tests/contract/
    echo "${{ steps.spec-check.outputs.new }}" > ../tests/contract/.spec-hash
```

## Newman Configuration

### Basic Usage

```bash
npx newman run collection.json --env-var "baseUrl=http://localhost:8080"
```

### With Authentication

If your API requires authentication:

```bash
npx newman run collection.json \
  --env-var "baseUrl=http://localhost:8080" \
  --env-var "authToken=$API_TOKEN"
```

In your Postman collection pre-request script:

```javascript
pm.request.headers.add({
  key: 'Authorization',
  value: 'Bearer ' + pm.environment.get('authToken')
});
```

### Reporter Options

```bash
# CLI output only
npx newman run collection.json

# JUnit for CI integration
npx newman run collection.json \
  --reporters cli,junit \
  --reporter-junit-export results.xml

# HTML report
npx newman run collection.json \
  --reporters cli,html \
  --reporter-html-export report.html

# All reporters
npx newman run collection.json \
  --reporters cli,junit,html \
  --reporter-junit-export results.xml \
  --reporter-html-export report.html
```

### Running Specific Tests

```bash
# Run only the Persons folder
npx newman run collection.json --folder "Persons"

# Run multiple folders
npx newman run collection.json --folder "Persons" --folder "Households"
```

### Fail Fast

Stop on first failure:

```bash
npx newman run collection.json --bail
```

### Timeouts

```bash
# Request timeout (ms)
npx newman run collection.json --timeout-request 10000

# Script timeout (ms)
npx newman run collection.json --timeout-script 5000
```

## Environment Variables

The generated collection uses these variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `baseUrl` | `http://localhost:1080` | API base URL |
| `personId` | From examples | ID for single-resource operations |
| `householdId` | From examples | ID for household operations |
| `applicationId` | From examples | ID for application operations |

Override in CI:

```bash
npx newman run collection.json \
  --env-var "baseUrl=http://localhost:8080" \
  --env-var "personId=test-person-123"
```

## Debugging Failures

### View Request/Response Details

```bash
npx newman run collection.json --verbose
```

### Export Failed Requests

```bash
npx newman run collection.json \
  --reporter-cli-show-timestamps \
  --reporter-cli-no-assertions
```

### Common Issues

**Connection refused:**
- Backend not running or not ready
- Wrong port in `baseUrl`
- Backend not listening on expected interface

**404 errors:**
- Paths don't match spec (check casing, pluralization)
- Resource IDs in collection don't exist in your database

**Schema validation errors:**
- Response shape doesn't match spec
- Missing required fields
- Wrong data types

**Authentication errors:**
- Token not set or expired
- Auth header format incorrect

## Integrating with Backend Test Suite

You can also run Newman programmatically in your test suite:

```javascript
// tests/contract.test.js
import newman from 'newman';
import { describe, it } from 'node:test';

describe('Contract Tests', () => {
  it('should pass all contract tests', (done) => {
    newman.run({
      collection: require('./postman-collection.json'),
      envVar: [
        { key: 'baseUrl', value: process.env.API_URL || 'http://localhost:8080' }
      ],
      reporters: ['cli']
    }, (err, summary) => {
      if (err) return done(err);
      if (summary.run.failures.length > 0) {
        done(new Error(`${summary.run.failures.length} contract tests failed`));
      } else {
        done();
      }
    });
  });
});
```
