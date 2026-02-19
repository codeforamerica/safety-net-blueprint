## What It Does

Generates TypeScript SDK clients and JSON Schema files from resolved OpenAPI specs. Uses `@hey-api/openapi-ts` for TypeScript generation with Zod validation schemas.

## CLI Commands

These commands are installed as bin scripts. Run them via npm scripts in your `package.json` or with `npx`.

### `safety-net-generate-clients`

Generate a TypeScript SDK with Zod schemas from resolved OpenAPI specs.

```json
"scripts": {
  "clients": "safety-net-generate-clients --specs=./resolved --out=./src/api"
}
```

### `safety-net-generate-json-schema`

Convert OpenAPI component schemas to standalone JSON Schema files.

```json
"scripts": {
  "json-schema": "safety-net-generate-json-schema --specs=./resolved --out=./json-schemas"
}
```

## Usage Example

```json
"scripts": {
  "resolve": "safety-net-resolve --base=./node_modules/@codeforamerica/safety-net-blueprint-contracts --overlays=./overlays --out=./resolved",
  "clients": "safety-net-generate-clients --specs=./resolved --out=./src/api"
}
```

```bash
npm run resolve
npm run clients
```
