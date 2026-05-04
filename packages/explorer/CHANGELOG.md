# Changelog

All notable changes to `@codeforamerica/safety-net-blueprint-explorer` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note:** This package is not currently published to npm. Versions are tracked for internal release coordination and may begin shipping to npm in a future release.

## [Unreleased]

## [1.3.0] - 2026-05-04

### Added

- **Initial workspace package release.** Promotes `packages/explorer` (renamed from `packages/design`) to a proper workspace package with `package.json`, build scripts (`build`, `build:context-map`, `build:service-blueprints`), and dependencies (`ajv`, `js-yaml`, optional `puppeteer` and `jszip` for PNG export)
- **Context map** (`context-map/`): interactive HTML diagram of bounded contexts and event-driven relationships (DDD Context Map pattern). Overview shows 11 domains color-coded by design status with a cross-cutting concerns banner. Click a domain to drill into a centered detail view with all partner domains and event/API inventories on each connection. Build pipeline: render fragments → assemble HTML → scan gaps → export PNGs and zip
- **Service blueprints** (`service-blueprints/`): generates service blueprint diagrams from blueprint contract data. Outputs both a Figma plugin (`figma-plugin/dist/`) and an SVG file (`output/<domain>.svg`) from the same blueprint data. Includes a baseline intake blueprint with 5-phase swim-lane structure (caseworker content, design notes, system row, SNAP/Medicaid differentiated in determination phase)
- **Project palette applied to context map**: indigo (#2B1A78) primary, sand (#F3F3F3) banner, teal (#00AD93) for implemented, purple (#5650BE) for planned, red (#AF121D) for gaps; uniform sand lifelines across all actors
- **Per-operand `par` fragment labels** in flow sequence diagrams (rendered as HTML divs so lifelines don't paint over the text)
- **Sequence flow diagrams** with hover integration details and responsive scaling
- **Adoption Model artifact** (`adoption-model/`): visual representation of the adoption model with PNG export pipeline (`export:adoption-model` script)
- **Determination flow** in the context map: `submit-for-determination` section, supervisor approval with task-claim pattern, `determination.recorded → communications` for NOA, `self: case_management` creates case
- **Federal verification flow** rendered as direct API calls (FDSH, IEVS, SAVE, SSA) outside the `par` fragment, reflecting that they are not event-driven subscriptions

### Changed

- **Directory layout standardized**: each tool uses `src/`, `config/`, `output/`, and `dist/` consistently. Generated outputs (HTML, SVG, zip) are committed; intermediate fragments and PNGs in `dist/` are gitignored
- **Federal verification calls** moved out of the `par` fragment in the Application Submission flow — they are direct API calls from intake, not event-driven subscriptions, and now render as a sequential step after verification items are created
- **Hex click reliability** improved: hex polygon and labels are wrapped in a `<g>` so the whole group is clickable, not just the polygon
- **`par`/`opt` fragment separators** no longer overlap at nested fragment boundaries
- **Withdrawal flow** removed from the context map (still documented in `docs/architecture/`)
- **`context-schema.json`** renamed to `config/annotations-schema.json` (service blueprints)
- **Service blueprint zip export** moved from `output/` to `dist/`

### Removed

- Pre-existing `proto-hex.html` prototype (no longer needed)
