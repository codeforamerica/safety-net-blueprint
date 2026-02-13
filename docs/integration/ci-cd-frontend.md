# CI/CD for Frontend

> **Status: Draft**

This guide covers building and testing frontend applications that consume Safety Net APIs.

## Testing Against the Mock Server

Use the mock server for integration tests when the real backend isn't available or you want deterministic test data.

### GitHub Actions

```yaml
# .github/workflows/test.yml
name: Frontend Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout frontend
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Checkout API toolkit
        uses: actions/checkout@v4
        with:
          repository: codeforamerica/safety-net-apis
          path: openapi-toolkit

      - name: Start mock server
        working-directory: openapi-toolkit
        run: |
          npm install
          STATE=<your-state> npm run mock:setup
          STATE=<your-state> npm run mock:start &

          # Wait for server to be ready
          sleep 5
          curl --retry 10 --retry-delay 1 http://localhost:1080/persons

      - name: Install frontend dependencies
        run: npm install

      - name: Run tests
        env:
          REACT_APP_API_URL: http://localhost:1080
          VITE_API_URL: http://localhost:1080
          NEXT_PUBLIC_API_URL: http://localhost:1080
        run: npm test

      - name: Run E2E tests
        env:
          REACT_APP_API_URL: http://localhost:1080
        run: npm run test:e2e
```

### GitLab CI

```yaml
# .gitlab-ci.yml
test:
  image: node:20
  services:
    - name: node:20
      alias: mock-server
      command: ["sh", "-c", "git clone https://github.com/codeforamerica/safety-net-apis.git && cd safety-net-apis && npm install && STATE=<your-state> npm run mock:start"]

  script:
    - npm install
    - REACT_APP_API_URL=http://mock-server:1080 npm test
```

## Testing Against Real Backend

For staging/integration environments:

```yaml
test-staging:
  runs-on: ubuntu-latest
  environment: staging

  steps:
    - uses: actions/checkout@v4

    - name: Run tests against staging
      env:
        REACT_APP_API_URL: ${{ secrets.STAGING_API_URL }}
        API_TOKEN: ${{ secrets.STAGING_API_TOKEN }}
      run: |
        npm install
        npm test
```

## Keeping API Clients Updated

### Manual Update Script

Add to your frontend's `package.json`:

```json
{
  "scripts": {
    "api:update": "cd ../safety-net-apis && git pull && STATE=<your-state> npm run clients:generate && cp -r packages/clients/dist-packages/<your-state>/* ../your-frontend/src/api/generated/"
  }
}
```

### Automated PR on Spec Changes

Create a workflow that watches for spec changes and opens a PR:

```yaml
# .github/workflows/update-api-clients.yml
name: Update API Clients

on:
  repository_dispatch:
    types: [api-spec-updated]
  schedule:
    # Check daily
    - cron: '0 0 * * *'
  workflow_dispatch:

jobs:
  update-clients:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.PAT_TOKEN }}

      - name: Clone API toolkit
        run: |
          git clone https://github.com/codeforamerica/safety-net-apis.git
          cd safety-net-apis
          npm install

      - name: Generate clients
        run: |
          cd safety-net-apis
          STATE=<your-state> npm run clients:generate

      - name: Check for changes
        id: diff
        run: |
          cp -r safety-net-apis/packages/clients/dist-packages/<your-state>/* src/api/generated/
          git diff --quiet src/api/generated/ || echo "changed=true" >> $GITHUB_OUTPUT

      - name: Create PR
        if: steps.diff.outputs.changed == 'true'
        uses: peter-evans/create-pull-request@v5
        with:
          token: ${{ secrets.PAT_TOKEN }}
          commit-message: 'chore: update API clients'
          title: 'Update API clients from latest spec'
          body: |
            Auto-generated update to API clients.

            Review the changes and ensure types are compatible.
          branch: update-api-clients
          delete-branch: true
```

## Build Configuration

### Environment Variables

Configure your build to use different API URLs per environment:

**React (Create React App):**

```bash
# .env.development
REACT_APP_API_URL=http://localhost:1080

# .env.production
REACT_APP_API_URL=https://api.example.com
```

**Vite:**

```bash
# .env.development
VITE_API_URL=http://localhost:1080

# .env.production
VITE_API_URL=https://api.example.com
```

**Next.js:**

```bash
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:1080

# .env.production
NEXT_PUBLIC_API_URL=https://api.example.com
```

### API Client Configuration

```typescript
// src/api/config.ts
import { createClient, createConfig } from './generated/workflow/client';

const API_URL = process.env.REACT_APP_API_URL
  || process.env.VITE_API_URL
  || process.env.NEXT_PUBLIC_API_URL
  || 'http://localhost:1080';

export const client = createClient(createConfig({
  baseURL: API_URL,
}));
```

## E2E Testing with Cypress

```javascript
// cypress/support/commands.js
Cypress.Commands.add('resetMockData', () => {
  cy.exec('cd ../safety-net-apis && npm run mock:reset');
});

// cypress/e2e/persons.cy.js
describe('Persons', () => {
  beforeEach(() => {
    cy.resetMockData();
  });

  it('lists persons', () => {
    cy.visit('/persons');
    cy.get('[data-testid="person-row"]').should('have.length.at.least', 1);
  });
});
```

## E2E Testing with Playwright

```typescript
// playwright.config.ts
export default defineConfig({
  webServer: [
    {
      command: 'cd ../safety-net-apis && STATE=<your-state> npm run mock:start',
      port: 1080,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev',
      port: 3000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});

// tests/persons.spec.ts
test('lists persons', async ({ page }) => {
  await page.goto('/persons');
  await expect(page.getByTestId('person-row')).toHaveCount(3);
});
```

## Type Checking in CI

Ensure generated types are compatible with your codebase:

```yaml
- name: Type check
  run: npm run typecheck  # or: npx tsc --noEmit
```

## Caching

Speed up CI by caching the toolkit:

```yaml
- name: Cache API toolkit
  uses: actions/cache@v3
  with:
    path: openapi-toolkit/node_modules
    key: api-toolkit-${{ hashFiles('openapi-toolkit/package-lock.json') }}

- name: Install toolkit dependencies
  working-directory: openapi-toolkit
  run: npm install
```

## Debugging

### Mock Server Logs

```yaml
- name: Start mock server with logs
  working-directory: openapi-toolkit
  run: |
    STATE=<your-state> npm run mock:start 2>&1 | tee mock-server.log &
    sleep 5

- name: Upload mock server logs
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: mock-server-logs
    path: openapi-toolkit/mock-server.log
```

### Network Debugging

```yaml
- name: Debug API connection
  run: |
    curl -v http://localhost:1080/persons || true
    netstat -tlnp || true
```
