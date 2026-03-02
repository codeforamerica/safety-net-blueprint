# Walkthrough: From Definition to Working System

**Estimated time:** 30-45 minutes

**Prerequisites:**

- Node.js >= 20.19.0
- npm
- A text editor
- A terminal

**What you'll build:** A pizza API to learn the patterns, then explore the real benefits system artifacts. You'll see how contract-driven development turns definitions into working systems — without writing application code.

---

## Section 0: Setup

Clone the repository and install dependencies:

```bash
git clone https://github.com/codeforamerica/safety-net-blueprint.git
cd safety-net-blueprint
npm install
```

Verify everything is working:

```bash
npm run validate
```

All checks should pass. If you see errors, check the [Troubleshooting guide](../reference/troubleshooting.md).

> **Windows users:** Throughout this tutorial, commands that stop a server use `npx kill-port <port>`. This works cross-platform. If you see references to `lsof` or `kill` elsewhere, use `npx kill-port` instead.

---

## Section 1: Create a Pizza API

Run the API generator:

```bash
npm run api:new -- -n pizza -r Pizza
```

This creates two files:

1. **`packages/contracts/pizza-openapi.yaml`** — The OpenAPI spec. Open it in your editor. You'll see:
   - A `Pizza` schema with fields like `name`, `description`, and `status`
   - CRUD paths: `GET /pizzas`, `POST /pizzas`, `GET /pizzas/{pizzaId}`, `PUT /pizzas/{pizzaId}`, `DELETE /pizzas/{pizzaId}`
   - Standard response schemas for lists, single items, and errors

2. **`packages/contracts/pizza-openapi-examples.yaml`** — Seed data that the mock server loads on startup.

**Why it matters:** The spec is the source of truth. Tooling generates endpoints, validation, documentation, and clients from it. You never write boilerplate CRUD code — you describe what the resource looks like and the system handles the rest.

**Learn more:** [Creating APIs](../guides/creating-apis.md)

---

## Section 2: Start the Mock Server

Start the mock server:

```bash
npm run mock:start
```

Watch the console output. The server:

- Auto-discovers all OpenAPI specs in `packages/contracts/`, including your new pizza spec
- Creates an in-memory SQLite database for each resource
- Registers CRUD endpoints for every spec
- Loads seed data from the example files

You should see output like:

```
======================================================================
Starting Mock API Server
======================================================================
Discovering specs in: .../packages/contracts
  Found: applications-openapi.yaml
  Found: case-management-openapi.yaml
  ...
  Found: pizza-openapi.yaml
  ...
Registering routes...
  POST   /pizzas
  GET    /pizzas
  GET    /pizzas/:pizzaId
  PUT    /pizzas/:pizzaId
  DELETE /pizzas/:pizzaId
  ...
Mock server running at http://localhost:1080
```

**Why it matters:** No code written — the spec *is* the implementation. Teams can start building against this immediately: integration testing, frontend development, validating requirements. When the real backend is ready, they switch over. Same API contract — plug and play.

**Learn more:** [Mock Server Guide](../guides/mock-server.md)

---

## Section 3: Test the API

With the mock server running, open a new terminal.

**Get all pizzas** (should be an empty list):

```bash
curl http://localhost:1080/pizzas
```

<details>
<summary>PowerShell equivalent</summary>

```powershell
Invoke-WebRequest -Uri http://localhost:1080/pizzas | Select-Object -ExpandProperty Content
```

</details>

Expected response:

```json
{
  "data": [],
  "meta": { "total": 0 }
}
```

**Create a pizza:**

```bash
curl -X POST http://localhost:1080/pizzas \
  -H "Content-Type: application/json" \
  -d '{"name": "Pepperoni", "description": "Classic pepperoni pizza", "status": "active"}'
```

<details>
<summary>PowerShell equivalent</summary>

```powershell
$body = '{"name": "Pepperoni", "description": "Classic pepperoni pizza", "status": "active"}'
Invoke-WebRequest -Uri http://localhost:1080/pizzas -Method POST -ContentType "application/json" -Body $body | Select-Object -ExpandProperty Content
```

</details>

Expected response (IDs and timestamps will differ):

```json
{
  "id": "a1b2c3d4-...",
  "name": "Pepperoni",
  "description": "Classic pepperoni pizza",
  "status": "active",
  "createdAt": "2025-01-15T10:30:00.000Z",
  "updatedAt": "2025-01-15T10:30:00.000Z"
}
```

The server generated `id`, `createdAt`, and `updatedAt` automatically.

**Get all pizzas again:**

```bash
curl http://localhost:1080/pizzas
```

The pepperoni pizza is there — it persisted in the in-memory database.

**Why it matters:** Because this is standard OpenAPI, you automatically get Swagger docs (`npm run mock:swagger`), Postman collections (`npm run postman:generate`), and typed API clients (`npm run clients:typescript`) — all the tooling your teams already use.

---

## Section 4: See Validation in Action

Try creating a pizza with fields the schema doesn't know about:

```bash
curl -X POST http://localhost:1080/pizzas \
  -H "Content-Type: application/json" \
  -d '{"pizzaName": "Supreme", "toppings": ["pepperoni", "mushrooms", "olives"], "crustType": "stuffed"}'
```

<details>
<summary>PowerShell equivalent</summary>

```powershell
$body = '{"pizzaName": "Supreme", "toppings": ["pepperoni", "mushrooms", "olives"], "crustType": "stuffed"}'
Invoke-WebRequest -Uri http://localhost:1080/pizzas -Method POST -ContentType "application/json" -Body $body | Select-Object -ExpandProperty Content
```

</details>

Expected response — a `422 Unprocessable Entity`:

```json
{
  "errors": [
    { "message": "\"pizzaName\" is not allowed" },
    { "message": "\"toppings\" is not allowed" },
    { "message": "\"crustType\" is not allowed" },
    { "message": "\"name\" is required" }
  ]
}
```

The contract enforces itself. The pizza schema only knows about `name`, `description`, and `status`. If you want toppings, you have to change the definition — which is exactly what overlays are for.

**Why it matters:** Validation isn't something you write — it's derived from the spec. Every field, every type, every constraint is enforced automatically. This means your API documentation and your API behavior can never drift apart.

---

## Section 5: Customize with an Overlay

Instead of editing the base spec (which would create a maintenance burden), you'll write an overlay — a set of targeted modifications that layer on top.

Create the file `packages/contracts/overlays/demo/pizza-toppings.yaml`:

```yaml
overlay: 1.0.0
info:
  title: Custom Pizza Overlay
  version: 1.0.0
actions:
  # Add toppings — an array of strings
  - target: $.components.schemas.Pizza.properties
    description: Add toppings and crust type to Pizza
    update:
      toppings:
        type: array
        items:
          type: string
        description: List of toppings.
      crustType:
        type: string
        enum:
          - thin
          - thick
          - stuffed
        description: Type of crust.

  # Remove status — not needed for this use case
  - target: $.components.schemas.Pizza.properties.status
    description: Remove status field — not needed for pizzas
    remove: true

  # Rename name → pizzaName
  - target: $.components.schemas.Pizza.properties.name
    description: Rename name to pizzaName
    rename: pizzaName
```

Each action targets a specific location in the base spec using JSONPath:

- **`update`** adds or merges properties
- **`remove: true`** deletes a property
- **`rename`** changes a property key

The overlay customizes without copying. There's no separate version of the spec to maintain. When the base blueprint updates, the overlay applies on top of the new version.

**Learn more:** [State Overlays Guide](../guides/state-overlays.md)

---

## Section 6: Apply the Overlay and Test

Stop the running mock server:

```bash
npx kill-port 1080
```

Resolve the overlay — this produces a new spec with your customizations merged in:

```bash
npm run overlay:resolve -- --overlays=packages/contracts/overlays/demo --out=packages/contracts/resolved
```

Start the mock server with the resolved specs:

```bash
node packages/mock-server/scripts/server.js --specs=packages/contracts/resolved
```

Now try the Supreme pizza again — the same request that was rejected in Section 4:

```bash
curl -X POST http://localhost:1080/pizzas \
  -H "Content-Type: application/json" \
  -d '{"pizzaName": "Supreme", "description": "Everything on it", "toppings": ["pepperoni", "mushrooms", "olives"], "crustType": "stuffed"}'
```

<details>
<summary>PowerShell equivalent</summary>

```powershell
$body = '{"pizzaName": "Supreme", "description": "Everything on it", "toppings": ["pepperoni", "mushrooms", "olives"], "crustType": "stuffed"}'
Invoke-WebRequest -Uri http://localhost:1080/pizzas -Method POST -ContentType "application/json" -Body $body | Select-Object -ExpandProperty Content
```

</details>

This time it succeeds. Get all pizzas:

```bash
curl http://localhost:1080/pizzas
```

The Supreme pizza is there — toppings, crust type, and all.

**Why it matters:** Same API, new fields, no separate copy to maintain. When the base blueprint updates, the customizations come along for the ride. This is how states customize the benefits system — adding state-specific fields, renaming programs, adjusting schemas — without forking.

---

## Section 7: Explore Behavioral Definitions

> **Note:** No commands to run here. The behavioral contract runtime is not yet built (tracked in issues [#84](https://github.com/codeforamerica/safety-net-blueprint/issues/84) and [#85](https://github.com/codeforamerica/safety-net-blueprint/issues/85)). This section shows the definition artifacts and explains what they produce.

Benefits systems aren't just data. An application has a lifecycle — it gets submitted, assigned, reviewed, approved or denied. The blueprint applies the same pattern: define the behavior in a table, and the system enforces it.

### State Machine

Here's the state machine for an application review process:

**State machine: `application_review`** | **Resource: `application`**

| current_state | action | next_state | guard | effects |
|---|---|---|---|---|
| *(new)* | submit | queued | — | `create_task`, `set_deadline`, `evaluate_routing_rules`, `create_audit_record` |
| queued | claim | in_progress | `assignee_is_empty` | `assign_to_caller`, `start_sla_clock`, `create_audit_record` |
| in_progress | request_info | pending_information | `caller_is_assignee` | `send_notice_to_applicant`, `pause_sla_clock`, `create_audit_record` |
| pending_information | receive_response | in_progress | — | `resume_sla_clock`, `notify_assignee`, `create_audit_record` |
| in_progress | complete | completed | `caller_is_assignee` | `record_determination`, `stop_sla_clock`, `send_notice_to_applicant`, `create_audit_record` |
| in_progress | release | queued | `caller_is_assignee` | `clear_assignment`, `evaluate_routing_rules`, `create_audit_record` |

Each row is a rule the system enforces. Let's walk through the `claim` transition:

- **current_state: `queued`** — The application is waiting in a queue
- **action: `claim`** — A caseworker wants to work on it
- **guard: `assignee_is_empty`** — Only succeeds if nobody else has claimed it
- **next_state: `in_progress`** — The application moves to active review
- **effects:** `assign_to_caller` records who claimed it, `start_sla_clock` begins tracking processing time, `create_audit_record` logs the action

The **guard** column uses named preconditions — `assignee_is_empty`, `caller_is_assignee` — that map to checks in the data model. The **effects** column uses named operations — `assign_to_caller`, `send_notice_to_applicant`, `create_audit_record`. You can't write arbitrary code. You pick from what the system knows how to do.

### Decision Table

Routing rules determine which queue an application lands in. First match wins:

| # | Condition | Queue |
|---|-----------|-------|
| 1 | program = SNAP, expedited_screening = true | snap-expedited |
| 2 | program = SNAP | snap-intake |
| 3 | program = Medical Assistance | medical-intake |
| 4 | *(any)* | general-intake |

The `evaluate_routing_rules` effect in the state machine triggers this table. Want to add a TANF queue next month? Add a row.

### Design Principles

A developer sets up the state machine and registers the available guards and effects. From there, a business analyst can:

- Add transitions (new rows in the state table)
- Change routing rules (new rows in the decision table)
- Adjust SLA thresholds
- Modify notification triggers

All without a code change. Guards and effects are named references from a catalog — composable, auditable, and readable by non-developers.

### What This Will Look Like When Built

The mock server will generate RPC endpoints from triggers — `POST /applications/:id/claim`, `POST /applications/:id/submit`, etc. It will enforce guards (rejecting invalid transitions) and execute effects (creating audit records, sending notifications). Adding a new transition means adding a row to the table.

**Learn more:** [Workflow Prototype](../prototypes/workflow-prototype.md)

---

## Section 8: Explore Frontend Definitions (Storybook)

> **Note:** The Storybook and harness features live on the `prototype/harness` branch. If you're on `main`, switch branches first:
> ```bash
> git checkout prototype/harness
> npm install
> ```

Start Storybook:

```bash
npm run storybook
```

This launches at `http://localhost:6006`.

### Form Definitions Are YAML

Open a form story in Storybook — for example, the application intake form. Then open the corresponding form definition in your editor:

```
packages/harness-designer/authored/contracts/application/intake.form.yaml
```

The YAML defines pages, sections, fields, input types, and layout — everything the form renderer needs. The app reads this definition and builds the form. No React components are hand-coded per form.

### Live Editing

Make a small change in the YAML — rename a field label, change an input type. Save the file. Storybook hot-reloads and the form updates instantly. Edit the definition, save, see it. No build step.

### Role Switching

With the same form data loaded, switch between role variants in Storybook:

- **Applicant** sees a step-by-step wizard
- **Caseworker** sees everything in collapsible sections with annotations
- **Reviewer** sees the form read-only with sensitive fields masked

Same data, different experience. The role determines what you see and can do. Role permissions are defined in:

```
packages/harness-designer/authored/permissions/applicant.yaml
packages/harness-designer/authored/permissions/caseworker.yaml
packages/harness-designer/authored/permissions/reviewer.yaml
```

### State-Specific Layouts

The caseworker review stories show different navigation styles by state:

- California: side-nav layout (`california-caseworker-sidenav.form.yaml`)
- Colorado: split-panel layout (`colorado-caseworker-sidenav-split.form.yaml`)

Same data, same fields, different layout — all from definitions.

**Why it matters:** Form definitions are the frontend equivalent of OpenAPI specs. Adding a field is a YAML change, not a code change. Changing a layout for a specific state is a definition change. The form renderer is generic; the definitions make it specific.

---

## Section 9: Cleanup

Stop any running servers:

```bash
npx kill-port 1080
npx kill-port 6006
```

Delete the generated files from this tutorial:

```bash
rm packages/contracts/pizza-openapi.yaml
rm packages/contracts/pizza-openapi-examples.yaml
rm -rf packages/contracts/overlays/demo/
rm -rf packages/contracts/resolved/
```

<details>
<summary>PowerShell equivalent</summary>

```powershell
Remove-Item packages/contracts/pizza-openapi.yaml
Remove-Item packages/contracts/pizza-openapi-examples.yaml
Remove-Item -Recurse -Force packages/contracts/overlays/demo/
Remove-Item -Recurse -Force packages/contracts/resolved/
```

</details>

Verify the repo is still clean:

```bash
npm run validate
```

All checks should pass — you're back to where you started.

---

## Section 10: What's Next

| I want to... | Start here |
|---|---|
| Design a new API resource | [Creating APIs](../guides/creating-apis.md) |
| Set up state-specific overlays | [State Setup Guide](../guides/state-setup-guide.md) |
| Understand the architecture | [Contract-Driven Architecture](../architecture/contract-driven-architecture.md) |
| Run the mock server in depth | [Mock Server Guide](../guides/mock-server.md) |
| Learn about overlay mechanics | [State Overlays Guide](../guides/state-overlays.md) |
| Explore the workflow prototype | [Workflow Prototype](../prototypes/workflow-prototype.md) |
| See form definitions in detail | [Application Review Prototype](../prototypes/application-review-prototype.md) |
| Validate specs and fix errors | [Validation Guide](../guides/validation.md) |
| Browse the full command reference | [Commands](../reference/commands.md) |
