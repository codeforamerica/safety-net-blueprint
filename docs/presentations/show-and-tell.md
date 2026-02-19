# Show and Tell: Safety Net Blueprint

**Duration:** 15 minutes
**Audience:** [TBD]
**Presenters:** [TBD]

---

## Narrative Arc

Started helping State X with modernization. Defined what the system should do up front so teams could start building right away — without waiting on vendors. When the systems turned out to need more than just data definitions, we expanded into behavioral rules. Then we applied the same idea to the screens people actually use. Here's where we are.

---

## Act 1: "The Problem" (2 min — tell)

**Setup:** No slides needed. Just talk.

State X is modernizing their benefits eligibility system — SNAP, Medicaid, TANF. They have multiple vendor procurements in flight, timelines are uncertain. Meanwhile:

- The team building the screens and the team building the backend are blocked on each other
- Both are blocked on procurement — you can't build against a system that doesn't exist yet
- The state's biggest concern: vendor lock-in. They've been burned before — the previous vendor owned everything. The data definitions, the business logic, all of it. Switching vendors meant starting over.

We asked: **what if you defined what the system should do before you pick who builds it?**

If you write down what the system does — what data it stores, what rules it follows, what the screens look like — as portable definitions, three things happen:

1. Teams can start building today against those definitions, without waiting for the vendor
2. The state can hand those definitions to vendors and say "can your system do this?"
3. When they switch vendors later — and they will — the definitions go with them

> **Transition:** "Let me show you what that looks like."

---

## Act 2: "The Data Layer" (6 min — show)

**Prerequisites:** Mock server is NOT running (we start it live). Harness app and Storybook are already running. Clean up beforehand: delete any previously generated test files (e.g., `pizza-openapi*.yaml`) so the generator runs fresh.

### Demo 1: Zero to working system (~3 min)

Start in the terminal. Nothing running.

> "Before I show you the real system, let me show you how fast this works. Let's make a pizza API."

Run the generator:

```bash
npm run api:new -- -n pizza -r Pizza
```

Two files created. Briefly open the generated `pizza-openapi.yaml` in the editor — just flash it, don't dwell.

> "That's a definition file — it describes what a Pizza looks like and what you can do with it. You'd obviously want to add your own fields — toppings, crust type, whether it's a calzone. But even this bare-bones version is enough to get a working system."

Start the server:

```bash
npm run mock:start
```

Point out the console output — it auto-discovers all definitions including the new one.

> "The server reads every definition and spins up a working system. No programming, no database setup."

Hit `http://localhost:1080/pizzas` in the browser — show the empty list.

Create one (have the request ready in Postman or curl):

```json
{
  "name": "Pepperoni",
  "description": "Classic pepperoni pizza",
  "status": "active"
}
```

Show the response — the system created it and assigned an ID and timestamps.

Now hit `http://localhost:1080/pizzas` again — the pizza is there. It persisted.

> "Not bad for a pizza with no toppings. The real definitions — for tasks, cases, appointments, applications — work exactly the same way, just with fields that are a little more useful. Teams start building against them today. No vendor needed."

> "Definition to working system in about 90 seconds."

### Demo 2: State customization without forking (~3 min)

**Prerequisites:** Have the pizza overlay file ready (create before the demo at `packages/contracts/overlays/demo/pizza-toppings.yaml`):

```yaml
overlay: 1.0.0
info:
  title: State X Pizza Overlay
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

Open the overlay file in the editor.

> "Remember our pizza API only had a name and a status. State X needs toppings and a crust type — so they add those. They don't need the status field — so they remove it. And they want to rename 'name' to 'pizzaName' — so they do that too. Add, remove, rename — all without touching the original definition."

Resolve the overlay and restart the mock server pointing at the resolved specs:

```bash
npm run overlay:resolve -- --overlays=packages/contracts/overlays/demo --out=packages/contracts/resolved && lsof -ti :1080 | xargs kill && node packages/mock-server/scripts/server.js --specs=packages/contracts/resolved
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

Hit `/pizzas` — the supreme pizza is there, toppings and all.

> "Same API, new fields, no fork. When we update the base blueprint, the state gets those updates automatically. Their customizations come along for the ride."

> **Transition:** "So far this defines what data the system stores. But benefits systems aren't just data. A task has a lifecycle. An application goes through stages. The interesting part is the behavior."

---

## Act 3: "Beyond Data — Behavioral and Frontend Definitions" (5 min — show)

### Demo 3: Behavioral definitions (2 min — show table, tell behavior)

**Note:** The runtime isn't built yet — this is showing the definition artifacts and explaining what they produce. Issues #84 and #85 track the implementation.

Open the state transition table from the workflow prototype (show the table, not code):

| From State | To State | Trigger | Preconditions | What Happens |
|------------|----------|---------|---------------|--------------|
| *(creation)* | pending | — | — | Look up deadline, evaluate routing rules, create audit record |
| pending | in_progress | claim | Task is unassigned; worker has the right skills | Assign to worker, create audit record, notify |
| in_progress | completed | complete | Caller is the assigned worker | Record outcome, create audit record; conditional follow-up |
| in_progress | pending | release | Caller is the assigned worker | Clear assignment, create audit record, re-evaluate routing |

> "This is a table — it could be a spreadsheet. Each row describes a valid transition: what triggers it, what has to be true first, and what happens when it fires. A caseworker claims a task — the system checks: is the task available? Does this worker have the right skills? If yes, it assigns the task and creates an audit record. Try to claim it again? The system rejects it — it's already taken. All of that is defined in this table, not written as custom code."

Show the decision table for routing rules:

| # | Program | Action | Destination |
|---|---------|--------|-------------|
| 1 | SNAP | Route to queue | snap-intake |
| 2 | any | Route to queue | general-intake |

> "Routing rules are another table. SNAP tasks go to the SNAP queue. Want to add Medicaid routing? Add a row. Switch vendors? This table goes with you."

> **Transition:** "That's the backend — the rules the system enforces. But we realized the same problem exists on the screens people use. Different programs need different forms, different fields, different visibility rules. So we applied the same approach."

### Demo 4: Frontend definitions (3 min — Storybook + harness app)

**Prerequisites:** Harness app already running (port 5173), Storybook already running (port 6006). Form definition files ready to open in editor.

**Note:** Create demo-specific form layouts if needed to keep this tight. The pizza list-detail requires a `/pizzas` route in the harness app and a pizza list-detail form definition — create these before the demo.

**Storybook — definitions and design** (http://localhost:6006):

*Form definition + live edit:* Open a form story with the form definition YAML in the editor side by side.

> "This is a form definition. Pages, fields, layout, what type of input to use — all in one file. The app reads this and builds the form."

Make a change — add a field, rename a label, change an input type. Save. The preview updates instantly.

> "Edit the definition, save, see it. No build step."

*Caseworker review with annotations:* Open the caseworker side-by-side review story. Point out the annotations displayed alongside the form fields — which programs require the field, federal vs state statutes, what's been modified by the state.

> "These annotations are another contract. Every field carries its program requirements, the statute that requires it, and what the state changed. The caseworker sees this context right in the review — CalFresh instead of SNAP, Medi-Cal instead of Medicaid, California statute citations alongside federal ones."

*Role switching + navigation styles:* With the same form data loaded, flip between role variants — applicant sees a step-by-step wizard, caseworker sees everything in collapsible sections, reviewer sees it read-only with sensitive fields hidden. Then flip between navigation styles — California side-nav, Colorado split-panel.

> "Same data, different experience. The role determines what you see and can do. The state determines the layout. All from definitions."

**Harness app — live system** (http://localhost:5173):

*List-detail with mock data:* Show the applications list — real data from the mock server. Click into one to show the detail view.

> "This is hitting the same server we started earlier. The list, the detail view, the data — all real, all from definitions."

*Pizza list-detail:* Navigate to `/pizzas` — the pizza we created in Demo 1 is there. Click into it.

> "Remember the pizza? Same list-detail pattern, same server. The system doesn't know the difference between an application and a pizza — it reads the definition and builds the screen."

---

## Close: "Where This Goes" (2 min — tell)

Three things this enables:

1. **Build before you buy.** The server gives teams a working system today. Screen development doesn't wait for procurement. When the vendor is selected, the definitions describe what they need to implement.

2. **Evaluate with confidence.** Hand a vendor the definitions — the rules, the forms, the data model — and ask "can your system do this?" It's a testable spec, not a 200-page RFP.

3. **Prevent lock-in.** The definitions are portable. The data model, the business rules, the form layouts — they belong to the state, not the vendor. Switch vendors, the definitions go with you.

And because it's open source, states build on each other's work. State X's SNAP customization benefits State Y. The blueprint grows with every adoption.

> "We started with data definitions. We expanded to behavioral rules. We applied it to the screens. The result is a portable specification for how benefits systems work — and a working prototype that proves it runs."

---

## Pre-Demo Checklist

**Already running before you start:**
- [ ] Harness app running: `npm run harness:dev` (port 5173)
- [ ] Storybook running: `npm run storybook` (port 6006)
- [ ] Seed data ready (loads automatically when mock server starts)

**Ready but not running:**
- [ ] Mock server (started live in Demo 1)
- [ ] Pizza overlay file created at `packages/contracts/overlays/demo/pizza-toppings.yaml`
- [ ] Pizza list-detail form definition ready
- [ ] Demo-specific form layouts ready (if needed)
- [ ] Any leftover pizza-openapi*.yaml files cleaned up

**Have open in tabs:**
- [ ] Terminal (for running commands)
- [ ] Editor with pizza overlay file
- [ ] Browser at localhost:1080 (ready for mock server)
- [ ] Browser at localhost:5173 (harness app)
- [ ] Browser at localhost:6006 (Storybook)
- [ ] Postman/curl with pizza creation requests ready
