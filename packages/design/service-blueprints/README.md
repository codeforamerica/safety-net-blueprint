# Service Blueprints

Tools for generating service blueprint diagrams from blueprint contract data. The content comes from a data file, so the same tooling works for any domain area or state without code changes.

Running `node build.js` produces two outputs from the same blueprint data:

- **Figma plugin** (`figma/dist/`) — generates native Figma frames and components that designers can edit and customize
- **SVG file** — a rendered preview of the same diagram, shareable without Figma

The SVG is useful for quick review, documentation, and sharing with stakeholders who don't have Figma access. The Figma output is what designers use as a working baseline.

## What you need

- **Figma Desktop** — the web app does not support local plugin development
- **Node.js 18+** and npm
- Editor access to the Figma file you want to generate into (Viewer access is not enough)

Install dependencies once from the `figma/` directory:

```bash
cd figma && npm install
```

## Using the baseline blueprint

The repo includes a baseline intake blueprint. Additional domain blueprints are planned as future work. To build:

```bash
node build.js        # builds Figma plugin → figma/dist/ and renders SVG
```

In Figma Desktop: **Plugins → Development → Import plugin from manifest…**, select `figma/dist/manifest.json`. Run the plugin from the same menu and click **Generate**.

Re-running always creates a fresh frame — it won't overwrite existing work.

## Customizing for a state

State-specific content files are never committed to this repo (they're gitignored). Start from the baseline context file for the domain and modify it for your state.

1. Copy the baseline context file as a starting point:
   ```bash
   mkdir -p figma/src/blueprints/states/<state>
   cp figma/src/blueprints/<domain>-context.yaml figma/src/blueprints/states/<state>/<domain>-context.yaml
   ```
2. Edit `figma/src/blueprints/states/<state>/<domain>-context.yaml` with state-specific content.
3. Generate the blueprint JSON:
   ```bash
   node figma/generate-blueprint.js figma/src/blueprints/states/<state>/<domain>-context.yaml
   ```
   This writes `figma/src/blueprints/states/<state>/<domain>.json`.
4. Build:
   ```bash
   node build.js figma/src/blueprints/states/<state> <output-dir>
   ```
   This builds the Figma plugin and renders an SVG preview alongside the blueprint JSON.
5. In Figma Desktop, import the manifest from `<output-dir>/manifest.json` and run the plugin.

## Authoring content

The YAML context file is the human-editable source. It defines the swim lanes, phases, and cards for the blueprint. The JSON is generated from it — edit the YAML, not the JSON directly.

To validate a context file before generating:

```bash
node figma/validate-definitions.js figma/src/blueprints/states/<state>/<domain>-context.yaml
```

### What's safe to edit

All display text is free-form and safe to change:

- `name` — the diagram title
- Lane, phase, and sub-phase `label` values — all header text
- Sub-phase `description` — human-readable notes, not rendered in the diagram
- Card `text`, `subtext`, and `citation` — no constraints

You can freely add editorial cards anywhere — `policy`, `pain-point`, `opportunity`, `note`, and `person-action` cards with explicit text. Card `type` must be one of those defined values, and `person-action` cards require an `actor` (`applicant`, `caseworker`, `supervisor`, or `system`). Avoid moving or removing existing cards in the system and data lanes; those represent contract-defined behavior and should stay aligned to their workflow steps.

Phase and sub-phase order reflects the workflow defined in the state machine contracts — avoid reordering existing ones, since their sequence represents the actual process flow. Adding new phases or sub-phases is fine, including inserting them between existing ones to document state-specific steps. Keep `event:` slots out of new phases or sub-phases; the baseline already covers all available events and renaming or moving them will break card generation.

Don't rename lane `id` values — cards in every sub-phase are keyed by lane ID and will disappear from the output if the ID changes.
