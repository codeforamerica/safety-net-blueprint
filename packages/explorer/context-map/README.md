# Context Map

An interactive diagram of the Safety Net Blueprint's bounded contexts and their event-driven relationships, following the DDD Context Map pattern.

## What it shows

- **Overview** — all 8 domains in their layout positions, with color-coded relationship arrows (implemented, planned, or direct API call)
- **Domain detail** — click any domain to see it centered, with all partner domains arranged around it and full event inventories labeled on each arrow
- **Navigation** — click any domain box to drill in; click "← Context Map" in the breadcrumb to return to the overview

## Building

From this directory:

```bash
node build.js
```

Output goes to `output/`:
- `overview.svg` — standalone overview diagram
- `{domain-id}.svg` — standalone per-domain detail diagram (one per domain)
- `context-map.html` — interactive single-page HTML assembling all SVGs with click navigation

Open `output/context-map.html` in any browser.

## Customizing

All content comes from `config.yaml` — no code changes needed for label or event updates.

### Renaming domains or events

Edit `config.yaml` and change any `label`, `description`, or event name under `events:`. Then rebuild:

```bash
node build.js
```

### Pointing at a custom config

You can maintain a separate `config.yaml` for a specific state or demo. The build scripts read from their own directory, so create a copy of this folder:

```
context-map-demo/
  config.yaml       ← your customized config
  render.js         ← symlink or copy
  build-html.js     ← symlink or copy
  build.js          ← symlink or copy
```

Then run:

```bash
node build.js
```

The output lands in `context-map-demo/output/`.

### Adding or removing domains

Under `domains:` in `config.yaml`, each entry needs:

```yaml
- id: my_domain         # used as filename slug and navigation ID
  label: My Domain      # displayed in the diagram
  status: partial       # partial | not-started | design-complete
  description: One line describing the domain
  x: 220               # top-left corner in the overview layout (px)
  y: 265
```

The `x`/`y` positions are for the overview grid only. Detail views use a circular layout computed automatically.

### Adding or removing events

Events live in `../config.yaml` (package-level). Each entry has one publisher and one or more subscribers:

```yaml
- name: application.submitted   # event name shown as a label on each arrow
  from: intake                  # publisher — always a single domain
  status: planned               # implemented | planned
  to:                           # one or more subscriber domain ids
    - eligibility
    - client_management
  # type: api                   # omit for event-driven; "api" = direct API call
```

- `status: implemented` → solid blue arrow
- `status: planned` → dashed gray arrow
- `type: api` → dashed amber arrow (direct service call, not event-driven)

If the same event has subscribers at different statuses (e.g., implemented to workflow, planned to eligibility), use two entries with the same name but different `status` values.

The renderer expands each `(from, to)` pair into a separate arrow, groups arrows sharing `(from, to, type, status)` to stack event names as labels, and draws bidirectional pairs as parallel offset arrows with domain-labeled headers.
