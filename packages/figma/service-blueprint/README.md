# Service Blueprint — Figma Plugin

A Figma plugin that generates service blueprint diagrams as native Figma frames. The content comes from a data file, so the same plugin works for any domain area or state without code changes.

## What you need

- **Figma Desktop** — the web app does not support local plugin development
- **Node.js 18+** and npm
- Editor access to the Figma file you want to generate into (Viewer access is not enough)

Install dependencies once:

```bash
npm install
```

## Using the baseline blueprint

The repo includes a baseline intake blueprint. Additional domain blueprints are planned as future work. To build and load it:

```bash
node build.js        # builds to dist/
```

In Figma Desktop: **Plugins → Development → Import plugin from manifest…**, select `dist/manifest.json`. Run the plugin from the same menu and click **Generate**.

Re-running always creates a fresh frame — it won't overwrite existing work.

## Customizing for a state

State-specific content files are never committed to this repo (they're gitignored). Start from the baseline context file for the domain and modify it for your state.

1. Copy the baseline context file as a starting point:
   ```bash
   mkdir -p src/blueprints/states/<state>
   cp src/blueprints/<domain>-context.yaml src/blueprints/states/<state>/<domain>-context.yaml
   ```
2. Edit `src/blueprints/states/<state>/<domain>-context.yaml` with state-specific content.
3. Generate the blueprint JSON:
   ```bash
   node generate-blueprint.js src/blueprints/states/<state>/<domain>-context.yaml
   ```
   This writes `src/blueprints/states/<state>/<domain>.json`.
4. Build the plugin against that data:
   ```bash
   node build.js src/blueprints/states/<state> <output-dir>
   ```
5. In Figma Desktop, import the manifest from `<output-dir>/manifest.json` and run the plugin.

To preview the blueprint without Figma, render it as an SVG locally:

```bash
node render-svg.js src/blueprints/states/<state>/<domain>.json
```

## Authoring content

The YAML context file is the human-editable source. It defines the swim lanes, phases, and cards for the blueprint. The JSON is generated from it — edit the YAML, not the JSON directly.

To validate a context file before generating:

```bash
node validate-definitions.js src/blueprints/states/<state>/<domain>-context.yaml
```

### What's safe to edit

All display text is free-form and safe to change:

- `name` — the diagram title
- Lane, phase, and sub-phase `label` values — all header text
- Sub-phase `description` — human-readable notes, not rendered in the diagram
- Card `text`, `subtext`, and `citation` — no constraints

You can freely add editorial cards anywhere — `policy`, `pain-point`, `opportunity`, `note`, and `person-action` cards with explicit text. Avoid moving or removing existing cards in the system and data lanes; those represent contract-defined behavior and should stay aligned to their workflow steps.

Phase and sub-phase order reflects the workflow defined in the state machine contracts — avoid reordering existing ones, since their sequence represents the actual process flow. Adding new phases or sub-phases is fine, including inserting them between existing ones to document state-specific steps. Keep `event:` slots out of new phases or sub-phases, since those require a matching state machine transition.

System, data, and event cards form the technical layer of the blueprint and should stay grouped together, aligned to their corresponding workflow steps. Even where individual cards aren't yet formally contract-driven, treat the technical layer as a unit — states should add to it or annotate it, not move it around. The goal is that every card in those lanes eventually traces back to a contract artifact.

### What can break things

These fields are load-bearing — change them carefully and always run `validate` afterward:

- **Lane `id`** — cards in every sub-phase are keyed by lane ID. Rename one and all its cards disappear from the output.
- **`event:` values** — must match a trigger or event name in the state machine YAML. A mismatch produces a warning and may generate an empty or incorrect card.
- **Card `type`** — must be one of the defined values: `person-action`, `system`, `policy`, `domain-event`, `data-entity`, `pain-point`, `opportunity`, `note`.
- **Card `actor`** — must be `applicant`, `caseworker`, `supervisor`, or `system`. Required on every `person-action` card.
- **`domain`** — must match the `domain` field in the referenced state machine YAML.
- **`stateMachine`** — relative path to the state machine file; must resolve to a real file.

**Rule of thumb:** labels and prose are safe. IDs, types, actor values, and event references are load-bearing.
