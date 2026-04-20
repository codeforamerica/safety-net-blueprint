# Service Blueprint — Figma Plugin

Generates service blueprint diagrams as native Figma frames and components. Content is driven by a JSON data file, so the plugin works across states and domains without code changes.

## Who this is for

- **Designers** — run the plugin to generate a baseline diagram in Figma, then customize it.
- **Developers** — author or update blueprint JSON files, build the plugin, and load it into Figma.

---

## For designers: generating a blueprint

1. Open Figma Desktop.
2. Go to **Plugins → Development → Import plugin from manifest…** and select the `manifest.json` in your built output directory.
3. Open any Figma file and run the plugin from the **Plugins → Development** menu.
4. Click **Generate**. The plugin creates a new frame in the current page.
5. Customize the generated frame — move, resize, restyle, or add annotations as needed.

Re-running the plugin always creates a fresh frame; it does not overwrite existing work.

---

## For developers

### Prerequisites

**Runtime:**
- Node.js 18 or later
- npm (included with Node.js)

**Figma:**
- Figma Desktop app (the web app does not support local plugin development)
- Editor access to the Figma file where you want to generate blueprints — Viewer access is not sufficient

**Install dependencies:**

```bash
npm install
```

npm packages used (all dev dependencies — nothing is shipped to users):

| Package | Purpose |
|---|---|
| `esbuild` | Bundles TypeScript plugin code for Figma |
| `typescript` | Type checking |
| `@figma/plugin-typings` | Figma Plugin API type definitions |
| `ajv` | JSON schema validation for blueprint files |
| `js-yaml` | Parses YAML context files |

### Build

```bash
node build.js                                          # baseline → dist/
node build.js src/blueprints/states/<state> dist/out   # state-specific → dist/out/
node build.js --watch                                  # watch mode
```

The build stages the selected blueprint JSON to `src/blueprints/_current.json`, bundles `src/main.ts` with esbuild, and copies `ui.html` and a manifest into the output directory.

Load the plugin in Figma Desktop via **Plugins → Development → Import plugin from manifest…**, pointing to the `manifest.json` in your output directory.

The plugin's manifest declares `"documentAccess": "dynamic-page"`, which means Figma will prompt for permission to access the current page when the plugin runs. This is required to create frames and components. No network access or external permissions are needed.

### Blueprint JSON format

Blueprint content lives in `src/blueprints/intake.json` (baseline) or `src/blueprints/states/<state>/intake.json` (state overlay).

```json
{
  "id": "intake",
  "name": "Intake",
  "lanes": [
    { "id": "applicant", "label": "Applicant" },
    { "id": "caseworker", "label": "Caseworker" }
  ],
  "phases": [
    {
      "id": "apply",
      "label": "Apply",
      "subPhases": [
        { "id": "apply-submit", "label": "Submit application" }
      ]
    }
  ],
  "cells": [
    {
      "laneId": "applicant",
      "subPhaseId": "apply-submit",
      "cards": [
        {
          "type": "person-action",
          "actor": "applicant",
          "text": "Submits online application"
        }
      ]
    }
  ]
}
```

Each cell is the intersection of one lane and one sub-phase column. A cell can contain multiple cards stacked vertically.

### Card types

| Type | Color | Use for |
|---|---|---|
| `person-action` | Actor-tinted | Action by a named actor — requires `actor` field |
| `staff-action` | Purple | Staff action (legacy; prefer `person-action`) |
| `system` | Green | Automated system action or output |
| `policy` | Beige | Regulatory or policy requirement |
| `domain-event` | Teal | Event emitted by the system |
| `data-entity` | Dark green | Data entity created or updated |
| `pain-point` | Salmon | Friction or barrier |
| `opportunity` | Amber | UX opportunity or improvement idea |
| `note` | Cream | General annotation |

### Actor types (for `person-action` cards)

| Actor | Color |
|---|---|
| `applicant` | Orange |
| `caseworker` | Purple |
| `supervisor` | Light purple |
| `system` | Green |

### Card fields

| Field | Required | Description |
|---|---|---|
| `type` | Yes | Card type (see above) |
| `text` | Yes | Primary label shown in the card header |
| `actor` | When type is `person-action` | Drives card color |
| `subtext` | No | Secondary text shown in the card body |

### Authoring from a context file

The baseline blueprint is generated from a YAML context file that is easier to author than raw JSON:

```bash
npm run generate     # generates src/blueprints/intake.json from intake-context.yaml
npm run validate     # validates the context file structure
npm run render       # renders a local SVG preview (no Figma needed)
```

The context file lives at `src/blueprints/intake-context.yaml`. State-specific context files live at `src/blueprints/states/<state>/intake-context.yaml`.

### Building for a state

State-specific blueprint files are gitignored and never committed to this repo — distribute them via gist or a shared drive.

1. Place the state's `intake-context.yaml` in `src/blueprints/states/<state>/`.
2. Generate the JSON: `node generate-blueprint.js src/blueprints/states/<state>/intake-context.yaml`
3. Build: `node build.js src/blueprints/states/<state> <output-dir>`
4. Load `<output-dir>/manifest.json` in Figma Desktop.

---

## Project structure

```
build.js                   Build script
render-svg.js              Local SVG preview renderer (no Figma)
src/
  main.ts                  Plugin entry point
  renderer.ts              Figma frame/component renderer
  types.ts                 Blueprint data types
  blueprints/
    intake-context.yaml    Baseline blueprint content (YAML, human-authored)
    intake.json            Generated blueprint data (committed baseline)
    states/                State-specific blueprints (gitignored)
dist/                      Built plugin output (gitignored)
```
