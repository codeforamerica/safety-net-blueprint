# Service Blueprints

Tools for generating service blueprint diagrams from blueprint contract data. The content comes from a data file, so the same tooling works for any domain area or state without code changes.

Running `node build.js` produces two outputs from the same blueprint data:

- **Figma plugin** (`figma-plugin/dist/`) — generates native Figma frames and components that designers can edit and customize
- **SVG file** (`output/<domain>.svg`) — a rendered preview of the same diagram, shareable without Figma

The SVG is useful for quick review, documentation, and sharing with stakeholders who don't have Figma access. The Figma output is what designers use as a working baseline.

## Directory layout

```
service-blueprints/
  config/                        # Human-editable source files
    intake-context.yaml          # Blueprint content (lanes, phases, cards)
    theme.yaml                   # Optional color overrides (empty = use defaults)
  output/                        # Generated outputs (committed)
    intake.json                  # Generated blueprint data (from generate-blueprint.js)
    intake.svg                   # Rendered SVG preview (from render-svg.js)
  context-schema.json            # JSON schema for validating context files
  generate-blueprint.js          # Generates intake.json from intake-context.yaml
  validate-context.js            # Validates a context file against context-schema.json
  figma-plugin/                  # Figma plugin source and tooling
    build.js                     # Builds the Figma plugin (dist/)
    src/                         # Plugin TypeScript source
    dist/                        # Built plugin — load this in Figma Desktop (gitignored)
  build.js                       # Orchestrates: Figma plugin build + SVG render
  render-svg.js                  # Standalone SVG renderer
```

## What you need

- **Figma Desktop** — the web app does not support local plugin development
- **Node.js 18+** and npm
- Editor access to the Figma file you want to generate into (Viewer access is not enough)

Install dependencies once from the `figma-plugin/` directory:

```bash
cd figma-plugin && npm install
```

## Using the baseline blueprint

The repo includes a baseline intake blueprint. To build:

```bash
node build.js        # builds Figma plugin → figma-plugin/dist/ and renders SVG → output/intake.svg
```

In Figma Desktop: **Plugins → Development → Import plugin from manifest…**, select `figma-plugin/dist/manifest.json`. Run the plugin from the same menu and click **Generate**.

Re-running always creates a fresh frame — it won't overwrite existing work.

## Customizing

To generate a blueprint from your own content files, point the build at your directory:

```bash
node build.js <path/to/your/dir>
```

Your directory should contain a context YAML file. Generate `intake.json` from it first, then run the build:

```bash
node generate-blueprint.js <path/to/your/dir/context.yaml>
node build.js <path/to/your/dir>
```

The SVG is written alongside `intake.json` in your directory.

To override colors, add a `theme.yaml` to your directory. See `config/theme.yaml` for the format — only the values you specify are overridden.

## Authoring content

`config/intake-context.yaml` is the human-editable source. After editing it, regenerate the JSON:

```bash
node generate-blueprint.js config/intake-context.yaml
```

To validate a context file before generating:

```bash
node validate-context.js config/intake-context.yaml
```

### What's safe to edit

All display text is free-form and safe to change:

- `name` — the diagram title
- Lane, phase, and sub-phase `label` values — all header text
- Sub-phase `description` — human-readable notes, not rendered in the diagram
- Card `text`, `subtext`, and `citation` — no constraints

You can freely add editorial cards anywhere — `policy`, `pain-point`, `opportunity`, `note`, and `person-action` cards with explicit text. Card `type` must be one of those defined values, and `person-action` cards require an `actor` (`applicant`, `caseworker`, or `supervisor`). Avoid moving or removing existing cards in the system and data lanes; those represent contract-defined behavior and should stay aligned to their workflow steps.

Phase and sub-phase order reflects the workflow defined in the state machine contracts — avoid reordering existing ones, since their sequence represents the actual process flow. Adding new phases or sub-phases is fine, including inserting them between existing ones to document state-specific steps.

Don't rename lane `id` values — cards in every sub-phase are keyed by lane ID and will disappear from the output if the ID changes.
