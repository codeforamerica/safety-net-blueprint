## What's Included

- **OpenAPI specs** (`*.yaml`) — base API specifications for safety net programs
- **Component schemas** (`components/`) — shared schemas, parameters, and responses
- **Overlay files** (`overlays/`) — state-specific variations using [OpenAPI Overlay Specification 1.0.0](https://github.com/OAI/Overlay-Specification)
- **API patterns** (`patterns/`) — design pattern rules for validation
- **Validation** (`src/validation/`) — OpenAPI syntax and pattern validation
- **Overlay resolver** (`src/overlay/`) — merges base specs with state overlays

## CLI Commands

These commands are installed as bin scripts. Run them via npm scripts in your `package.json` or with `npx`.

### `safety-net-resolve`

Resolve overlays against base specs to produce state-specific output.

```json
"scripts": {
  "resolve": "safety-net-resolve --base=./node_modules/@codeforamerica/safety-net-blueprint-contracts --overlays=./overlays --out=./resolved"
}
```

### `safety-net-design-reference`

Export an HTML design reference from OpenAPI specs.

```json
"scripts": {
  "design-reference": "safety-net-design-reference --specs=. --out=./docs"
}
```

## Programmatic API

```javascript
import { applyOverlay } from '@codeforamerica/safety-net-blueprint-contracts/overlay';
import { validateSpec } from '@codeforamerica/safety-net-blueprint-contracts/validation';
import { discoverApiSpecs, loadAllSpecs } from '@codeforamerica/safety-net-blueprint-contracts/loader';
import { validatePatterns } from '@codeforamerica/safety-net-blueprint-contracts/patterns';
```
