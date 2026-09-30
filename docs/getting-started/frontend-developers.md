# Getting Started: Frontend Developers

> **Status: Draft**

This guide is for developers building frontend applications that consume Safety Net APIs. The APIs include both REST endpoints (CRUD operations on resources) and RPC endpoints (behavioral operations like claiming a task or submitting an application). Field metadata contracts drive context-dependent UI rendering — field annotations, permissions, and labels are generated into the TypeScript client at build time and consumed by the frontend without hardcoding domain-specific logic.

> **Frontend harness packages** (form engine, safety harness, harness designer) live in a separate repository: [codeforamerica/safety-net-harness](https://github.com/codeforamerica/safety-net-harness). See that repo for form rendering, layout, component mapping, and navigation.

See also: [Contract-Driven Architecture](../architecture/contract-driven-architecture.md) | [Domain Design](../architecture/domains/domain-design.md)

> **Note:** The REST APIs and mock server for CRUD operations work today. The behavioral contract capabilities described below — RPC APIs, field metadata, event streams — are being built as part of the [steel thread prototypes](../prototypes/workflow-prototype.md). This guide describes the target developer experience.

## What You'll Work With

- [**REST APIs**](#rest-apis-data-operations) — standard CRUD operations on resources (`GET /workflow/tasks`, `POST /intake/applications`)
- [**RPC APIs**](#rpc-apis-behavioral-operations) — behavioral operations generated from state machine triggers (`POST /workflow/tasks/:id/claim`, `POST /intake/applications/:id/submit`)
- [**Field metadata**](#field-metadata-context-dependent-ui) — field annotations (program relevance, verification requirements, regulatory citations) generated into the TypeScript client at build time
- [**Event streams**](#event-streams-real-time-updates) — real-time updates via Server-Sent Events (`GET /events/stream?domain=workflow`)
- [**Browser-side rules evaluation**](#browser-side-rules-evaluation) — run eligibility rules and screening logic client-side with no server round-trip, using the same compiled graph the backend evaluates
- [**Mock server**](#develop-against-the-mock-server) — development adapter that interprets behavioral contracts (state machines, rules, metrics) with an in-memory database — no production backend needed

## Prerequisites

- Node.js >= 22.11.0
- A frontend project (React, Vue, etc.)
- Familiarity with TypeScript

## Initial Setup

The toolkit provides base specs, scripts, and a mock server. States create their own repository and install the base packages:

```bash
npm install @codeforamerica/safety-net-blueprint-contracts @codeforamerica/safety-net-blueprint-mock-server @codeforamerica/safety-net-blueprint-clients
```

See the [Setup Guide](../guides/setup-guide.md) for the full setup process, including overlays and resolved specs.

For development within this repository:

```bash
git clone https://github.com/codeforamerica/safety-net-blueprint.git
cd safety-net-blueprint
npm install
```

## Development Workflow

### Develop Against the Mock Server

The mock server interprets behavioral contracts — state machines, rules, metrics — with an in-memory database. RPC endpoints are auto-generated from state machine triggers, so adding a transition is a contract change, not server code.

```bash
# Within this repository
STATE=<your-state> npm start

# Or in a state repository with resolved specs
npm run mock:start
```

The mock server runs at http://localhost:1080. Point your frontend at it:

```bash
REACT_APP_API_URL=http://localhost:1080 npm start
```

### Exploring the API

Browse all endpoints — REST and RPC — via Swagger UI:

```bash
STATE=<your-state> npm run mock:start:all
```

Visit http://localhost:3000 to see all endpoints and schemas.

### Generated TypeScript Clients

The `@codeforamerica/safety-net-blueprint-clients` package generates typed SDK functions and Zod schemas from resolved specs:

```typescript
import {
  getTask,
  listTasks,
  type Task,
} from './generated/workflow';

// List tasks filtered by status and queue
const response = await listTasks({ query: { status: 'pending', queueId: 'snap-intake' } });
```

See [API Clients](../integration/api-clients.md) for client generation and framework integrations.

## Working with the APIs

### REST APIs (Data Operations)

REST APIs provide standard CRUD operations on resources — create, read, update, delete, list, and search:

```typescript
// Get a single task by ID
const task = await getTask({ path: { id: taskId } });

// Create a new application
const app = await createApplication({
  body: { programs: { snap: true, medicalAssistance: true } }
});
```

### RPC APIs (Behavioral Operations)

RPC APIs trigger state transitions — they enforce guards (preconditions), execute effects (side effects like audit records and notifications), and reject invalid transitions with a 409 response. Each RPC endpoint corresponds to a trigger in the domain's state machine.

```typescript
// Claim a task — transitions from pending to in_progress
// Guards: task must be unassigned, caller must have required skills
await claimTask({ path: { id: taskId } });

// Complete a task with an outcome
// Guard: caller must be the assigned worker
await completeTask({
  path: { id: taskId },
  body: { outcome: 'approved', notes: 'All documents verified' }
});
```

A 409 response means either the transition is invalid from the current state or a guard condition failed. The response body includes details about which guard failed.

### Field Metadata (Context-Dependent UI)

Field metadata tells the frontend how fields relate to programs, what verification is needed, and who can access them — without hardcoding domain-specific logic. The frontend fetches field metadata from the backend and uses it to drive rendering decisions.

```typescript
// 1. Fetch field metadata from the backend
const fieldMetadata = await getFieldMetadata({ query: { domain: 'intake' } });

// 2. Fetch work item records (e.g., SectionReview) for a member
const sectionReviews = await listSectionReviews({
  query: { memberId: member.id }
});

// 3. For each field in a section, look up its metadata
for (const review of sectionReviews) {
  const sectionFields = fieldMetadata.fields.filter(f => f.section === review.sectionId);

  for (const field of sectionFields) {
    // 4. Render field with annotations — the frontend iterates over
    //    whatever annotation types exist without knowing what they mean
    renderField(field, field.annotations);
  }
}
```

The key principle: the frontend renders annotations generically. It doesn't know what "program relevance" or "verification requirement" means — it just displays them. Adding a new annotation type is a field metadata change, not a code change. Form layout and rendering are handled by the [safety-net-harness](https://github.com/codeforamerica/safety-net-harness) packages.

### Browser-Side Rules Evaluation

The `blueprint-rules-engine` package runs compiled rule graphs directly in the browser — no server round-trip required. This gives frontend developers a full rules evaluation capability on the client, enabling use cases like:

- **Eligibility screening tools** — run a ruleset against household data the user has entered and immediately show which programs they may qualify for
- **What-if scenarios** — let a caseworker or applicant adjust inputs and see how outcomes change in real time
- **Progressive intake forms** — identify exactly which inputs are still needed to resolve pending facts, so the UI can ask targeted follow-up questions rather than presenting a fixed form
- **Pre-submission feedback** — show applicants which determinations are already resolved and what's still needed before they submit

```typescript
import { evaluate } from '@codeforamerica/blueprint-rules-engine';

// compiledGraph is the *-graph.yaml for a ruleset, loaded as JSON
const nodes = evaluate(compiledGraph, inputs);

// Only output facts, keyed by name
const complete = Object.entries(nodes)
  .filter(([, n]) => n.type === 'output' && n.state === 'complete')
  .map(([name, n]) => [name, n.value]);
// → [['eligible', true], ['hasWorkEligibleAdults', false]]

const missing = Object.entries(nodes)
  .filter(([, n]) => n.type === 'output' && n.state === 'missing')
  .map(([name, n]) => [name, n.missing]);
// → [['benefitAmount', ['$.household.income', '$.household.expenses.housing']]]
```

The browser evaluator uses the same compiled graph and returns the same flat nodes map as the server-side evaluator. The rules endpoint filters this to output facts only — intermediate facts are available in the browser for debugging but are not part of the HTTP response. The backend evaluation at submission is authoritative — the browser evaluation is advisory.

See [Rules Contracts](../architecture/rules-contracts.md) for the full model.

### Event Streams (Real-Time Updates)

Subscribe to domain events via Server-Sent Events:

```typescript
const eventSource = new EventSource('/events/stream?domain=workflow');

eventSource.addEventListener('task.claimed', (event) => {
  const data = JSON.parse(event.data);
  // data contains TaskClaimedEvent payload: taskId, claimedById, queueId, claimedAt
  refreshTaskList();
});
```

### Runtime Validation with Zod

For custom validation scenarios, import generated Zod schemas:

```typescript
import { zTask } from './generated/workflow/zod.gen';

const parseResult = zTask.safeParse(apiResponse);
if (!parseResult.success) {
  console.error('Validation failed:', parseResult.error);
}
```

## Mock to Production

During development, the frontend talks to the mock server. In production, it talks to a production adapter built by the state. The API surface is the same — swapping from mock to production changes the adapter, not the frontend code.

```
Development:  [Frontend] → [Mock Server]
Production:   [Frontend] → [Production Adapter] → [Vendor System]
```

See [Contract-Driven Architecture — Development to production](../architecture/contract-driven-architecture.md#development-to-production) for the full transition process.

## Next Steps

- [Setup Guide](../guides/setup-guide.md) — Setting up a state repository with overlays
- [Contract-Driven Architecture](../architecture/contract-driven-architecture.md) — How contracts define the API surface
- [Workflow Prototype](../prototypes/workflow-prototype.md) — Example of behavioral contracts in action (state machine, rules, metrics)
- [Application Review Prototype](../prototypes/application-review-prototype.md) — Example of field metadata contracts in action
- [API Clients](../integration/api-clients.md) — Generated TypeScript clients and framework integrations
