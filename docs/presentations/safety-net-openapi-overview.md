---
marp: true
theme: default
paginate: true
---

# Safety Net Blueprint
## Enabling Faster, More Consistent API Development

---

# The Challenge

**Building APIs for safety net programs is complex:**

- Multiple states with different requirements and terminology
- Teams building frontends need stable, documented APIs
- Backend teams need clear specifications to implement against
- Testing integrations is slow and error-prone
- Inconsistent API patterns lead to confusion and bugs
- Vendor-specific APIs create lock-in and limit flexibility

---

# The Solution: A Shared API Toolkit for Safety Net Programs

**Pre-built API definitions for benefits eligibility that power:**

- Documentation
- Simulated APIs
- Ready-to-use code libraries

**And support:**

- API verification
- State customizations
- No vendor lock-in

**Plus:** Define a new data type once, and the toolkit automatically generates a complete API with documentation, simulated data, and code libraries - all following established patterns.

---

# What This Toolkit Provides

| Capability | Benefit |
|------------|---------|
| API Definitions | Clear, versioned contracts everyone can read |
| Workflow & Business Rules | SLA deadlines, task routing, and approval workflows you own — not locked in a vendor |
| Vendor Portability | Switch backend or frontend vendors without losing your rules, customizations, or apps |
| Simulated API | Build and test without a real backend |
| Ready-to-Use Code Libraries | Pre-built integration code with error checking |
| Test Suites | Manual and automated API testing |
| State Customizations | Adapt for each state without duplicating work |
| Automated Validation | Catch errors before deployment |

---

# Feature 1: API Definitions

## The Foundation

**A shared language for describing what the API does**

- Written in plain text that both humans and computers can read
- Describes what data you can request and what you'll get back
- Industry standard language (OpenAPI) used by thousands of organizations

**Our definitions include:**
- Common benefits data: persons, households, applications, income
- Consistent patterns for searching, filtering, and pagination
- Reusable building blocks for addresses, names, phone numbers

---

# Feature 1: API Definitions

## What It Looks Like

```yaml
paths:
  /persons:
    get:
      summary: List persons
      parameters:
        - name: q        # Search
        - name: limit    # Pagination
        - name: offset
      responses:
        200:
          description: Paginated list of persons
```

**Everyone agrees on what the API will do before building it**

No more "I thought you were sending `firstName`, not `first_name`" conversations after the code is written.

---

# Feature 2: Interactive Documentation

## Browse and Try the API

**Auto-generated documentation you can interact with**

- Browse all available operations
- See examples of requests and responses
- Try API calls directly in your browser
- No coding required to explore

**Access:** `npm start` then visit `http://localhost:3000`

---

# Feature 2: Interactive Documentation

## Benefits

| For | Benefit |
|-----|---------|
| Product Managers | Understand what's possible |
| Frontend Developers | Know exactly what data to expect |
| Backend Developers | Clear implementation target |
| QA Engineers | See expected behavior |
| External Partners | Self-service integration docs |

---

# Feature 3: Simulated API

## Develop Without Waiting for the Real Backend

**Automatically generated from the API definitions**

- Create, read, update, and delete data
- Realistic pagination and search
- Pre-loaded with example data

**Start in seconds:** `npm start`

---

# Feature 3: Simulated API

## Search Capabilities

**Filter and search data just like the real API:**

| Query | Meaning |
|-------|---------|
| `status:active` | Exact match |
| `income:>1000` | Greater than |
| `name:*john*` | Contains |
| `programs:snap,tanf` | Multiple values |

```bash
GET /persons?q=status:active income:>1000&limit=10
```

---

# Feature 3: Simulated API

## A Real Working API, Not Just Static Responses

**Your changes are saved and persist across requests**

- Create a person, then fetch them later — they're still there
- Update a record, and the changes stick
- Delete something, and it's actually gone
- Test complete workflows from start to finish

**Fresh start when you need it:** Restart the server to reset all data back to the original examples

---

# Feature 3: Simulated API

## Benefits

| Role | Benefit |
|------|---------|
| Frontend Teams | Start building the same day — no waiting for the backend team's sprint to finish |
| Backend Teams | Clear target to implement against — no guessing what the frontend needs |
| QA Teams | Build realistic test scenarios piece by piece — add a person, update their income, submit their application — and verify each step works correctly |
| Demos | Show real functionality to stakeholders without setting up infrastructure |

---

# Feature 4: Ready-to-Use Code Libraries

## Pre-Built Integration Code

**Auto-generated code that connects your app to the API**

- Catches coding mistakes before you run the app
- Your code editor suggests available options as you type
- Automatically validates data coming from the API
- Works with popular web frameworks

---

# Feature 4: Ready-to-Use Code Libraries

## What It Looks Like

```typescript
import { persons, q, search } from '@codeforamerica/safety-net-colorado';

const client = persons.createApiClient(API_URL);

// Your editor autocompletes options and catches errors
const results = await client.listPersons({
  queries: {
    q: q(search.eq("status", "active")),
    limit: 25
  }
});

// results.items is guaranteed to be a list of Person objects
```

---

# Feature 4: Ready-to-Use Code Libraries

## Benefits

- **Catch errors early** — Misspell `firstName` as `fristName`? Your editor catches it instantly, not your users
- **Self-documenting** — Hover over any field to see what it means and what values are valid
- **Faster development** — Your editor suggests available fields as you type
- **Safer changes** — Rename a field? The compiler shows every place that needs updating
- **Data validation** — The API returns unexpected data? You'll know immediately, not when something breaks downstream

---

# Feature 4: Ready-to-Use Code Libraries

## Share Definitions as Packages

**Backend teams publish, frontend teams install**

- API definitions are packaged and published to npm
- Frontend teams install with one command:
  ```bash
  npm install @codeforamerica/safety-net-colorado
  ```
- Everyone works from the same source of truth
- Updates are as simple as upgrading the package version

**No copying files, no version mismatches**

---

# Feature 4: Ready-to-Use Code Libraries

## Built-In Search Helpers

**Construct search queries without memorizing syntax**

```typescript
import { q, search } from '@codeforamerica/safety-net-colorado';

// Readable, type-safe query building
const query = q(
  search.eq("status", "active"),      // status:active
  search.gt("income", 1000),          // income:>1000
  search.contains("name", "smith")    // name:*smith*
);
```

- Your editor suggests available search options
- Mistakes are caught before your code runs
- No need to remember query string formats

---

# Feature 5: State Customizations

## One Codebase, Multiple States

**The problem:** States have different:
- Program names (CalFresh vs SNAP vs Food Stamps)
- Required fields
- Allowed values
- Terminology

**The solution:** Customization files that adapt the base definitions for each state

---

# Feature 5: State Customizations

## How It Works

```
Base Definitions (shared)
        |
        v
  +-----+-----+
  |           |
  v           v
California   Colorado
Customizations Customizations
  |           |
  v           v
California   Colorado
   API         API
```

**Improvements to the base benefit all states automatically**

---

# Feature 5: State Customizations

## Example Customization

```yaml
# california/modifications.yaml
actions:
  - target: $.Person.properties.programs.items.enum
    description: California program names
    update:
      - calfresh      # California's SNAP
      - calworks      # California's TANF
      - medi_cal      # California's Medicaid
```

**State-specific changes without duplicating everything**

Without this, you'd maintain separate copies of the entire API for each state — and hope you remember to update all of them when something changes.

---

# Feature 6: Automated Validation

## Catch Errors Before They Ship

**Three layers of checking:**

1. **Structure** - Is the definition valid and complete?
2. **Conventions** - Does it follow naming rules and best practices?
3. **Patterns** - Does it include required fields and standard behaviors?

**Run with:** `npm run validate`

---

# Feature 6: Automated Validation

## What It Catches

| Issue | Example |
|-------|---------|
| Broken links | Reference to a file that doesn't exist |
| Wrong responses | Creating something should return "created", not "ok" |
| Missing features | List endpoint without pagination |
| Inconsistent naming | `user_name` instead of `userName` |
| Bad examples | Example data that doesn't match the definition |

---

# Feature 7: API Verification

## Verify the Backend Matches the Definition

**Auto-generated test suites enable:**

- Manual API testing during development
- Automated checks that run on every code change
- Verification that the real API matches what was defined

**Ensures frontend and backend stay in sync**

The frontend expects `firstName` but the backend sends `first_name`? These tests catch that mismatch before users see a broken page.

---

# Feature 7: API Verification

## Automated Pipeline Integration

```yaml
# Runs automatically when code changes
steps:
  - name: Run API verification tests
    run: |
      npx newman run postman-collection.json \
        --env-var "baseUrl=http://localhost:8080"
```

**Automated verification on every code change**

---

# Feature 8: New API Generator

## Define Once, Get Everything

**One command creates a complete, consistent API:**

```bash
npm run api:new -- --name "benefits" --resource "Benefit"
```

**From a single data type, you automatically get:**
- A complete API definition with create, read, update, delete, list, and search
- Interactive documentation
- A working simulated API
- Ready-to-use code libraries
- Starter example data to customize

**All following established patterns - consistent with every other API in the toolkit**

---

# Feature 9: Workflow & Business Rules

## Your Rules, Written Down and Portable

**Today, your business rules for processing benefits live inside your vendor's system:**

- "SNAP applications must be processed within 30 days"
- "Expedited cases go to the worker with the lightest caseload"
- "If an applicant doesn't respond to an information request in 10 days, send a reminder"
- "Supervisor approval is required before denying benefits"

If you switch vendors, someone has to re-enter every rule and hope nothing gets missed. If you want to audit how your system actually works, you're reading vendor documentation — not your own.

---

# Feature 9: Workflow & Business Rules

## What Changes

**The toolkit captures these rules in portable files your state owns:**

- Which worker gets which task, and why
- What the deadlines are for each program
- What happens when a deadline is about to be missed
- Who needs to approve what

**The rules are readable, auditable, and travel with you** — not with a vendor's contract.

When federal policy changes from 30-day to 21-day SNAP processing, you update one definition and every system that reads it — your case worker portal, your supervisor dashboard, your SLA reports — picks up the change.

---

# Feature 10: Vendor Portability

## Switch Systems Without Starting Over

**A common story:** Your state spent two years building a case management frontend that workers love. Then the backend vendor's contract ends. Without portable definitions, the new vendor's system has different field names, different workflows, different APIs — and the frontend team starts over.

**With the toolkit:** The frontend was built against shared definitions. The new vendor builds a connector to those same definitions. The frontend keeps working.

---

# Feature 10: Vendor Portability

## What You Keep When Vendors Change

| You Replace | You Keep |
|---|---|
| The connection to the old vendor's system | Your business rules and workflows |
| Vendor-specific configuration | Your case worker portal and client-facing apps |
| | Your state's customizations |
| | Your test suites and quality checks |

**The years of work your teams invested in frontends, customizations, and business rules are protected** — vendor transitions affect the plumbing, not the product.

---

# How Teams Use This Toolkit

## Frontend Developers

1. `npm start` - Start simulated API
2. Install the code library package
3. Build the user interface against the simulated API
4. Switch to the real backend when ready

**No waiting for backend development**

No more "the backend isn't ready yet" blocking your sprint. Build and test your UI today.

---

# How Teams Use This Toolkit

## Backend Developers

1. Read the API definition (or create/customize one)
2. Implement the API to match
3. Run verification tests
4. Fix any mismatches

**Clear target, automated verification**

---

# How Teams Use This Toolkit

## Product & Design

1. Browse the interactive documentation
2. Understand available data and operations
3. Design features based on real API capabilities

**Self-service exploration**

---

# The Big Picture

```
+------------------+
| API Definitions  |  <-- Single Source of Truth
+------------------+
         |
    +----+----+----+----+
    |    |    |    |    |
    v    v    v    v    v
  Docs Simul- Code  Test  State
        ated  Libs  Suites Custom-
        API               ization
    |    |      |     |     |
    v    v      v     v     v
  View Test   Build Verify Multi-
  APIs APIs   Apps  Backend State
```

---

# Benefits Summary

| Benefit | Impact |
|---------|--------|
| Faster frontend development | Start immediately with simulated API |
| Fewer integration bugs | Code libraries catch errors early |
| Consistent API design | Validation enforces patterns |
| Multi-state support | Customizations adapt for each state |
| Automated testing | Verification runs on every code change |
| Better documentation | Always up-to-date with definitions |
| Portable business rules | SLA deadlines, routing, and workflows travel with you — not a vendor |
| Vendor portability | Switch backend or frontend vendors without rebuilding from scratch |

---

# Getting Started

**For your team:**

```bash
# Clone the repository
git clone https://github.com/codeforamerica/safety-net-blueprint.git

# Install dependencies
npm install

# Set your state
export STATE=california

# Start exploring
npm start
```

**Visit `http://localhost:3000` to browse the APIs**

---

# Questions?

**Resources:**

- Repository: `github.com/codeforamerica/safety-net-blueprint`
- Backend Guide: `docs/getting-started/backend-developers.md`
- Frontend Guide: `docs/getting-started/frontend-developers.md`

**Key commands:**
- `npm start` - Start simulated API + docs
- `npm run validate` - Validate definitions
- `npm run clients:typescript` - Generate code libraries
