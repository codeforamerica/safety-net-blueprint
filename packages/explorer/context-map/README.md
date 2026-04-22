# Context Map

An interactive diagram of the Safety Net Blueprint's bounded contexts and their event-driven relationships, following the DDD Context Map pattern.

## What it shows

- **Overview** — all domains in their layout positions, color-coded by design status, with a cross-cutting concerns banner
- **Domain detail** — click any domain card to see it centered with all partner domains arranged around it, and event/API inventories labeled on each connection
- **Navigation** — click any domain box to drill in; click "← Context Map" in the breadcrumb to return to the overview
- Domains with status `not-started` appear in the overview but are not clickable and do not have a detail page

## Building

From this directory:

```bash
node build.js
```

This runs `render.js` (reads config, generates HTML fragments) then `build-html.js` (assembles everything into a single file).

Output goes to `output/context-map.html`. Open it in any browser.

## Config files

There are two config files. Neither requires code changes for routine updates.

### `../config.yaml` — domain and event registry

The source of truth for all domain definitions, events, and API calls. Schema: [`../config-schema.json`](../config-schema.json).

### `config.yaml` — diagram layout

Controls the overview grid positions for each domain box. Schema: [`config-schema.json`](config-schema.json).

## Adding or changing domains

Edit `../config.yaml`. Each domain entry needs:

```yaml
- id: my_domain           # snake_case; used as navigation ID
  label: My Domain        # display name in the diagram
  status: partial         # partial | not-started | design-complete
  description: One line describing the domain's responsibility
  entities: [EntityA, EntityB]
```

Then add a layout position in `config.yaml`:

```yaml
layout:
  my_domain: { x: 300, y: 160 }   # top-left corner of the 220×105 px box
```

Rebuild with `node build.js`.

## Adding or changing events

Edit `../config.yaml` under `events:`. Each entry has one publisher and one or more subscribers:

```yaml
- name: application.submitted     # shown as a label on the connection
  publisher: intake                # domain ID that emits the event
  status: implemented              # implemented | planned
  subscribers:
    - workflow
    - eligibility
```

The `status` reflects whether the publisher is emitting the event — not whether individual subscribers have implemented their handlers. List all subscribers in a single entry.

## Adding or changing direct API calls

Edit `../config.yaml` under `apis:`. Each entry is one operation and the domains that invoke it:

```yaml
- call: income verification (IRS)
  domain: data_exchange
  status: planned
  callers:
    - eligibility
    - intake
    - workflow
```

## How the diagram renders connections

- One connection line per unique (publisher/caller, subscriber/callee) pair
- Bidirectional connections draw as two parallel offset arrows
- Events and API calls for the same pair are grouped into a single "Integrations" card on the connection midpoint
- ⚡ = domain event, ⇄ = direct API call
- The radius of the detail view layout auto-sizes based on the number of events in the busiest connection, clamped to keep all boxes within the canvas
