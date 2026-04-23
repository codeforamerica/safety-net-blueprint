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
    intake-annotations.yaml      # Phase structure, regulations, data entities, notes
    theme.yaml                   # Optional color overrides (empty = use defaults)
  output/                        # Generated outputs (committed)
    intake.json                  # Generated blueprint data (from generate-blueprint.js)
    intake.svg                   # Rendered SVG preview (from render-svg.js)
  generate-blueprint.js          # Generates intake.json from config.yaml + annotations
  figma-plugin/                  # Figma plugin source and tooling
    build.js                     # Builds the Figma plugin (dist/)
    src/                         # Plugin TypeScript source
    dist/                        # Built plugin — load this in Figma Desktop (gitignored)
  build.js                       # Orchestrates: generate → Figma plugin build + SVG render
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

Your directory should contain an annotations YAML file. The baseline `build.js` always generates `output/intake.json` from the baseline annotations. For a state-specific build, generate first and then run the build:

```bash
node generate-blueprint.js <path/to/your/dir/annotations.yaml>
node build.js <path/to/your/dir>
```

The SVG is written alongside `intake.json` in your directory.

To override colors, add a `theme.yaml` to your directory. See `config/theme.yaml` for the format — only the values you specify are overridden.

## How content is generated

Blueprint content comes from two sources:

- **`packages/explorer/config.yaml`** — the source of truth for flows. Actor steps, events, and system self-messages (including gap markers) are derived from flow steps automatically.
- **`config/intake-annotations.yaml`** — the annotation layer. Defines phase/sub-phase structure and adds what config.yaml cannot: regulatory citations, data entity descriptions, detailed caseworker actions, notes, and opportunities.

`build.js` runs `generate-blueprint.js` automatically — you don't need to run it manually.

### What to edit

**To change workflow steps or add events:** edit `packages/explorer/config.yaml`.

**To add regulations, data entities, notes, or opportunities:** edit `config/intake-annotations.yaml`. Each sub-phase has a `cards` map keyed by lane ID. Supported card types: `policy`, `data-entity`, `note`, `opportunity`, `person-action`, `system`.

**To change sub-phase structure:** add or reorder `subPhases` in `intake-annotations.yaml`. Each sub-phase references a flow + step indices — update the `flow` and `steps` fields to control which config.yaml steps are derived for that sub-phase.

Don't rename lane `id` values — cards in every sub-phase are keyed by lane ID and will disappear from the output if the ID changes.
