# Getting Started: Frontend Developers

> **Status: Draft**

This guide is for developers building frontend applications that consume Safety Net APIs. The APIs include both REST endpoints (CRUD operations on resources) and RPC endpoints (behavioral operations like claiming a task or submitting an application). Form definitions drive context-dependent UI rendering — the frontend doesn't hardcode domain-specific logic.

See also: [Contract-Driven Architecture](../architecture/contract-driven-architecture.md) | [Domain Design](../architecture/domain-design.md)

> **Note:** The REST APIs and mock server for CRUD operations work today. The behavioral contract capabilities described below — RPC APIs, form definitions, event streams — are being built as part of the [steel thread prototypes](../prototypes/workflow-prototype.md). This guide describes the target developer experience.

## What You'll Work With

- [**REST APIs**](#rest-apis-data-operations) — standard CRUD operations on resources (`GET /workflow/tasks`, `POST /intake/applications`)
- [**RPC APIs**](#rpc-apis-behavioral-operations) — behavioral operations generated from state machine triggers (`POST /workflow/tasks/:id/claim`, `POST /intake/applications/:id/submit`)
- [**Form definitions**](#form-definitions-context-dependent-ui) — declarative YAML that determines which sections and fields to display, visibility conditions, and field annotations (program relevance, verification requirements, regulatory citations)
- [**Event streams**](#event-streams-real-time-updates) — real-time updates via Server-Sent Events (`GET /events/stream?domain=workflow`)
- [**Mock server**](#develop-against-the-mock-server) — development adapter that interprets behavioral contracts (state machines, rules, metrics) with an in-memory database — no production backend needed

## Prerequisites

- Node.js >= 20.19.0
- A frontend project (React, Vue, etc.)
- Familiarity with TypeScript

## Initial Setup

The toolkit provides base specs, scripts, and a mock server. States create their own repository and install the base packages:

```bash
npm install @safety-net/contracts @safety-net/mock-server @safety-net/clients
```

See the [State Setup Guide](../guides/state-setup-guide.md) for the full setup process, including overlays and resolved specs.

For development within this repository:

```bash
git clone https://github.com/codeforamerica/safety-net-apis.git
cd safety-net-apis
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
STATE=<your-state> npm start
```

Visit http://localhost:3000 to see all endpoints and schemas.

### Generated TypeScript Clients

The `@safety-net/clients` package generates typed SDK functions and Zod schemas from resolved specs:

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

### Form Definitions (Context-Dependent UI)

Form definitions tell the frontend what to render without hardcoding domain-specific logic. The frontend fetches the form definition and uses it to determine sections, fields, visibility conditions, and annotations.

```typescript
// 1. Fetch the form definition
const formDef = await getFormDefinition();

// 2. Fetch work item records (e.g., SectionReview) for a member
const sectionReviews = await listSectionReviews({
  query: { memberId: member.id }
});

// 3. For each SectionReview, look up the matching section in the form definition
for (const review of sectionReviews) {
  const section = formDef.sections.find(s => s.id === review.sectionId);

  // 4. Evaluate visibleWhen condition against the member's data
  // (uses the same expression format as rule conditions, e.g., JSON Logic)
  if (evaluateCondition(section.visibleWhen, { member })) {
    // 5. Render fields with annotations — the frontend iterates over
    //    whatever annotation types exist without knowing what they mean
    for (const field of section.fields) {
      renderField(field, field.annotations);
    }
  }
}
```

The key principle: the frontend renders annotations generically. It doesn't know what "program relevance" or "verification requirement" means — it just displays them. Adding a new annotation type is a form definition change, not a code change.

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

- [State Setup Guide](../guides/state-setup-guide.md) — Setting up a state repository with overlays
- [Contract-Driven Architecture](../architecture/contract-driven-architecture.md) — How contracts define the API surface
- [Workflow Prototype](../prototypes/workflow-prototype.md) — Example of behavioral contracts in action (state machine, rules, metrics)
- [Application Review Prototype](../prototypes/application-review-prototype.md) — Example of form definitions in action
- [API Clients](../integration/api-clients.md) — Generated TypeScript clients and framework integrations
