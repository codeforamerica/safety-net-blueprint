# Show and Tell: Safety Net Blueprint

**Duration:** 15 minutes
**Audience:** [TBD]
**Presenters:** Two, splitting at the handoff between Demo 3 and Demo 4. The switch tells the story — the backend is up, now the frontend developer can start building.

| Section | Presenter | Represents |
|---|---|---|
| Act 1, Act 2, Demo 3 | Presenter A | Backend developer + business analyst |
| Demo 4, Close | Presenter B | Frontend developer — picks up wireframes from the designer and turns them into screen layouts |

---

## Narrative Arc

Started helping a state with modernization. Defined what the system should do up front so teams could start building right away — without waiting on vendors. When the systems turned out to need more than just data definitions, we expanded into behavioral rules. Then we applied the same idea to the screens people actually use. Here's where we are.

---

## Act 1: "The Problem" (2 min — tell)

**Presenter A** (backend developer + analyst)

**Setup:** No slides needed. Just talk.

A state that shall remain nameless is modernizing their benefits eligibility system. They have multiple vendor procurements in flight, timelines are uncertain. Meanwhile:

- The team building the screens is blocked on the backend — you can't build against a system that doesn't exist yet
- Everyone is blocked on procurement — timelines are uncertain and vendors haven't been selected
- The state's biggest concern: vendor lock-in. They've been burned before — the previous vendor owned everything. The data definitions, the business logic, all of it. Switching vendors meant starting over.

We asked: **what if you defined what the system should do before you pick who builds it?**

If you write down what the system should do — what data it stores, what rules it follows, what the screens look like — as a shared blueprint, three things happen:

1. Teams can start building today against the blueprint, without waiting for the vendor
2. The state can hand the blueprint to vendors and say "can your system do this?"
3. When they switch vendors later — and they will — the blueprint goes with them

> **Transition:** "We're going to show you what that looks like."

---

## Act 2: "The Data Layer" (6 min — show)

**Presenter A** (backend developer + analyst)

**Prerequisites:** Mock server is NOT running (we start it live). Harness app and Storybook are already running. Clean up beforehand: delete any previously generated test files (e.g., `pizza-shop-openapi*.yaml`) so the generator runs fresh.

### Demo 1: Zero to working system (~3 min)

Start in the terminal. Nothing running.

> "Before I get into the details, let me show you how fast this works. Let's make a pizza API."

Run the generator:

```bash
npm run api:new -- -n pizza-shop -r Pizza
```

Two files created. Briefly open the generated `pizza-shop-openapi.yaml` in the editor — just flash it, don't dwell.

> "Two files — a definition and some fake examples. The definition describes the pizza-shop domain: what a Pizza looks like and what you can do with it. The examples are seed data the mock server will load so you're not starting from nothing. You'd obviously want to add your own fields to your Pizza — toppings, crust type, size. But even this bare-bones version is enough to get you up and running."

Start the server:

```bash
npm run mock:start
```

> "That starts the mock server — it serves fake data so teams can build against a realistic API without a real backend. You can see in the console it auto-discovered every definition, including the pizza shop we just created. It reads each one and spins up a working back end — API, database, the works. No programming, no database setup. And because this is standard OpenAPI, you automatically get Swagger docs, Postman collections — all the tooling your teams already use. Teams can start building against this immediately — integration testing, screens, validating requirements — without waiting on the real system. And when the real system is ready, they switch over without missing a beat. Same API, same contract — plug and play."

> "Let's hit the API — `localhost:1080/pizzas`. Empty list, as expected. Now let's create one."

Create one (have the request ready in Postman or curl):

```json
{
  "name": "Pepperoni",
  "description": "Classic pepperoni pizza",
  "status": "active"
}
```

> "The system created it — assigned an ID, timestamps, the works. And if we hit `/pizzas` again — there it is. It persisted."

> "Not bad for a pizza with no toppings. The real blueprint — for tasks, cases, appointments, applications — works exactly the same way, just with fields that are a little more useful. Teams start building against it today. No vendor needed."

> "Definition to working system in about 90 seconds."

### Demo 2: State customization without forking (~3 min)

**Prerequisites:** Have the pizza overlay file ready (create before the demo at `packages/contracts/overlays/demo/pizza-toppings.yaml`).

> "So we have a pizza API — but right now it's the boilerplate version, with just a name, description, and status. Now imagine a pizza shop comes in and says: we need toppings, a crust type, we don't need status, and we want to call 'name' something different. In a traditional system, you'd make a copy and start editing it — now you have two versions to maintain. Here, we write an overlay."

```yaml
overlay: 1.0.0
info:
  title: Custom Pizza Overlay
  version: 1.0.0
actions:
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
  - target: $.components.schemas.Pizza.properties.status
    description: Remove status field — not needed for pizzas
    remove: true
  - target: $.components.schemas.Pizza.properties.name
    description: Rename name to pizzaName
    rename: pizzaName
```

But first — try creating a pizza with toppings *before* applying the overlay (have this request ready in Postman):

```json
{
  "pizzaName": "Supreme",
  "toppings": ["pepperoni", "mushrooms", "olives"],
  "crustType": "stuffed"
}
```

> "422 — toppings is not allowed, crustType is not allowed. The definition isn't just documentation — the system enforces it. Right now the pizza only knows about name, description, and status. If you want toppings, you have to change the definition."

Open the overlay file in the editor.

> "This is how they customize it. They need toppings and a crust type — so they add those. They don't need the status field — so they remove it. And they want to rename 'name' to 'pizzaName' — so they do that too. Add, remove, rename — all without touching the base version."

Resolve the overlay and restart the mock server pointing at the resolved specs:

```bash
npx kill-port 1080
npm run overlay:resolve -- --overlays=packages/contracts/overlays/demo --out=packages/contracts/resolved
node packages/mock-server/scripts/server.js --specs=packages/contracts/resolved
```

Create a pizza with the new fields:

```json
{
  "pizzaName": "Supreme",
  "description": "Everything on it",
  "toppings": ["pepperoni", "mushrooms", "olives"],
  "crustType": "stuffed"
}
```

> "And if we hit `/pizzas` — there's our supreme pizza, toppings and all. Same API, new fields, no separate copy of the code to maintain. When we update the base blueprint, the pizza shop gets those updates automatically. Their customizations come along for the ride."

> **Transition:** "I used a silly example — but the same pattern works for anything. A SNAP application, a Medicaid case, a provider enrollment. You define the data, add your customizations, and the system runs it. But benefits systems aren't just data — they have complex behaviors. An application moves through a lifecycle. Routing rules decide which queue it lands in. SLA clocks track processing deadlines. Guard rails prevent the wrong person from taking the wrong action. All of that is behavior that traditionally gets buried in code. So we applied the same approach: define the behavior as a blueprint too."

---

## Act 3: "Beyond Data — Behavioral and Frontend Definitions" (5 min — show)

### Demo 3: Behavioral definitions (2 min — show table, tell behavior)

**Presenter A** (backend developer + analyst)

**Note:** The runtime isn't built yet — this is showing the definition artifacts and explaining what they produce. Issues #84 and #85 track the implementation.

Open the state transition table from the workflow prototype.

> "Here's what that looks like in practice. A behavioral contract, as opposed to a data contract that we just showed you for a Pizza, is a set of tables — state machines define the lifecycle, decision tables define routing and priority rules, and there are catalogs for guards, effects, metrics, and audit requirements. I'll show you the two main ones. This first one is a state machine for an application review. Every row defines what can happen, what has to be true first, and what the system does when it happens. By design, it's a table that an analyst can understand and edit, together with a developer, who would typically be responsible for setting it up. From there, a business analyst can make changes - add transitions, change routing rules, adjust SLA thresholds — without any code changes."

**State machine: `application_review`** | **Object: `application`**

| current_state | action | next_state | guard | effects |
|---------------|--------|------------|-------|---------|
| *(new)* | submit | queued | — | `create_task`, `set_deadline`, `evaluate_routing_rules`, `create_audit_record` |
| queued | claim | in_progress | `assignee_is_empty` | `assign_to_caller`, `start_sla_clock`, `create_audit_record` |
| in_progress | request_info | pending_information | `caller_is_assignee` | `send_notice_to_applicant`, `pause_sla_clock`, `create_audit_record` |
| pending_information | receive_response | in_progress | — | `resume_sla_clock`, `notify_assignee`, `create_audit_record` |
| in_progress | complete | completed | `caller_is_assignee` | `record_determination`, `stop_sla_clock`, `send_notice_to_applicant`, `create_audit_record` |
| in_progress | release | queued | `caller_is_assignee` | `clear_assignment`, `evaluate_routing_rules`, `create_audit_record` |

> "Each row is a rule the system enforces on a specific object. This is an example state machine for an application. When an application comes in, the system creates a task, looks up the processing deadline, and routes it to a queue. A caseworker claims it — but only if it's unassigned. If they need pay stubs from the applicant, they request info — the SLA clock pauses so the applicant isn't penalized for processing time. When the documents come back, the clock resumes. The caseworker records a determination — approved or denied — and the system sends the notice. Every action creates an audit record automatically."

> "Routing is the same idea, different table. First match wins. Want to add a TANF queue next month? Add a row."

**Decision table: `routing_rules`** | **Object: `task`**

| # | Condition | Queue |
|---|-----------|-------|
| 1 | program = SNAP, expedited_screening = true | snap-expedited |
| 2 | program = SNAP | snap-intake |
| 3 | program = Medical Assistance | medical-intake |
| 4 | *(any)* | general-intake |


> **Handoff to Presenter B:** "Because these rules are configuration — not code — our mock server is able to read them, dynamically create the API endpoints, and execute the rules. You don't need a real system to test whether your routing sends expedited SNAP to the right queue. We applied this same contract-driven approach to the frontend — and I'll hand it over to [Presenter B] to show you what that looks like."

### Demo 4: Frontend definitions (3 min — Storybook + harness app)

**Presenter B** (frontend developer)

**Prerequisites:** Demo app already running (port 5173) with the applications list-detail as the landing page. Storybook already running (port 6006). Form definition files ready to open in editor.

**Note:** Create demo-specific form layouts if needed to keep this tight. The pizza list-detail requires a `/pizzas` route in the harness app and a pizza list-detail form definition — create these before the demo.

**Storybook — definitions and design** (http://localhost:6006):

*Form definition + live edit:* Open a form story with the form definition YAML in the editor side by side.

> "So [Presenter A] showed you data contracts and behavioral contracts. On the frontend side, the designer hands me wireframes — page layouts, field groupings, how the user moves through the form. I translate those into a form definition. The input types, validation rules, and constraints come from the data contracts that [Presenter A] showed you earlier — what kind of input to use, what options are available, what's required. The form definition brings those two things together: the designer's layout and the contract's data rules, in one definition file. The app reads it and builds the actual form. I don't hand-code React components per form — I describe the form, and the system renders it."

Make a change — add a field, rename a label, change an input type. Save. The preview updates instantly.

> "Edit the definition, save, see it. No build step."

*Caseworker review with annotations:* Open the caseworker side-by-side review story.

> "There's one more layer. Every field in a benefits form has regulatory context — which programs require it, what statute mandates it, whether the state customized it. We capture that as annotations — metadata attached to each field. You can see them here alongside the form fields. The caseworker sees this context right in the review — CalFresh instead of SNAP, Medi-Cal instead of Medicaid, which fields are required for which programs. These are defined the same way — contracts that the system reads and renders automatically."

*Role switching + navigation styles:* With the same form data loaded, flip between role variants — applicant sees a step-by-step wizard, caseworker sees everything in collapsible sections, reviewer sees it read-only with sensitive fields hidden. Then flip between navigation styles — California side-nav, Colorado split-panel.

> "Same data, different experience. The role determines what you see and can do. The state determines the layout. All from definitions."

**Demo app — live system** (http://localhost:5173):

*List-detail with mock data:* Open the applications list, click into one.

> "Storybook is great for designing and iterating on forms, but this is an actual app. This is a list-detail pattern — a list of records, in this case applications - click one, and you're in the detail view. It's hitting the same mock server that [Presenter A] started earlier — the one serving the pizza shop and all the other APIs. The list, the detail view, the data — all real, all driven by definitions."

*Pizza list-detail:* Navigate to `/pizzas`, click into the pizza.

> "Remember the pizza? There it is — same list-detail pattern, same server. The system doesn't know the difference between an application and a pizza — it reads the definition and builds the screen."

---

## Close: "Where This Goes" (2 min — tell)

**Presenter B** (frontend developer)

Three things this enables:

1. **Build before you buy.** The server gives teams a working system today. Screen development doesn't wait for procurement. When the vendor is selected, the definitions describe what they need to implement.

2. **Evaluate with confidence.** Hand a vendor the definitions — the rules, the forms, the data model — and ask "can your system do this?" It's a testable spec, not a 200-page RFP.

3. **Prevent lock-in.** The definitions are portable. The data model, the business rules, the form layouts — they belong to the state, not the vendor. Switch vendors, the definitions go with you.

And because it's open source, states build on each other's work. One state's SNAP customization benefits the next. The blueprint grows with every adoption.

> "We started with data definitions. We expanded to behavioral rules. We applied it to the screens. The result is a portable specification for how benefits systems work — and a working prototype that proves it runs."

---

## Pre-Demo Checklist

**Already running before you start:**
- [ ] Harness app running: `npm run harness:dev` (port 5173), landing on applications list-detail
- [ ] Storybook running: `npm run storybook` (port 6006)
- [ ] Seed data ready (loads automatically when mock server starts)

**Ready but not running:**
- [ ] Mock server (started live in Demo 1)
- [ ] Pizza overlay file created at `packages/contracts/overlays/demo/pizza-toppings.yaml`
- [ ] Pizza list-detail form definition ready
- [ ] Demo-specific form layouts ready (if needed)
- [ ] Any leftover pizza-shop-openapi*.yaml files cleaned up

**Have open in tabs:**
- [ ] Terminal (for running commands)
- [ ] Editor with pizza overlay file
- [ ] Browser at localhost:1080 (ready for mock server)
- [ ] Browser at localhost:5173 (harness app)
- [ ] Browser at localhost:6006 (Storybook)
- [ ] Postman/curl with pizza creation requests ready
