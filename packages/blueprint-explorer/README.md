# @codeforamerica/blueprint-explorer

> Static documentation generator for Blueprint framework projects — contract reference, state machine diagrams, event catalog, and data dictionaries

[![npm version](https://img.shields.io/npm/v/@codeforamerica/blueprint-explorer.svg)](https://www.npmjs.com/package/@codeforamerica/blueprint-explorer)
[![license](https://img.shields.io/npm/l/@codeforamerica/blueprint-explorer.svg)](https://github.com/codeforamerica/safety-net-blueprint/blob/main/LICENSE)

> **Pre-release:** This package is at `0.x`. Until `1.0.0`, minor versions may include breaking changes. Pin your version if stability matters.

## Installation

```bash
npm install --save-dev @codeforamerica/blueprint-explorer
```

## What It Does

Generates a set of static HTML reference tools from resolved Blueprint contract artifacts. Point it at your resolved specs to produce a browsable documentation hub that can be published as a GitHub Pages site or any static host.

| Tool | Description |
|------|-------------|
| **API Reference** | Endpoint docs derived from resolved OpenAPI specs — parameters, request/response schemas, status codes, and links to related state machine transitions. Each operation shows its call as curl and through the generated TypeScript client, and sends it to the mock running in the page |
| **State Machine Docs** | Full state machine reference — states, transitions, guard conditions, actor restrictions, and event subscriptions per resource |
| **Event Catalog** | Cross-domain event index — every emitted event with its publisher, payload schema, and known subscribers |
| **Data Dictionaries** | Field-level reference derived from writable schemas — field names, types, policy citations, and data classifications |
| **Context Map** | Domain relationship diagram showing cross-domain data dependencies |
| **Scenarios** | The Arazzo scenarios, played a step at a time against the mock server running in the browser, built from the contracts. Works served or opened from disk. The mock's files go in `mock/`, shared by every page that runs it, and the records you make carry from page to page within a browser tab. Reloading a page starts again from the sample records. Set `first_tour` in `config.yaml` to choose the scenario it opens with |

## Usage

```bash
# Build all tools
node build.js \
  --content=./packages/safety-net-explorer \
  --resolved=./resolved

# Build a single tool
node build.js --only=api-reference --resolved=./resolved
node build.js --only=state-machine-docs --resolved=./resolved
node build.js --only=event-catalog --resolved=./resolved
node build.js --only=data-dictionaries --resolved=./resolved
```

### A site's own script

Name a JavaScript file in `config.yaml`, relative to it, and every page loads it before the mock starts:

```yaml
script: portal.js
```

The script can send some APIs to real services by setting `BlueprintExplorer.routing`, in the mock server's routing format: a URL with `to`, or a `handler` function, such as one that adds the visitor's sign-in token. Every mock the explorer starts takes it, and with none, every call stays in the page.

```js
// portal.js
BlueprintExplorer.routing = [{
  api: 'communication-transcripts-audio-adapter',
  handler: async (request) => { /* add the token, then forward the call */ },
}];
```

The control panel lists the routing under "Where calls go", and each entry has a switch between the real service and the mock in the page, for the browser tab: the mock restarts without that entry, keeping records and stubs. A call the mock can't answer itself, such as an adapter's, then needs a stub, and the panel offers the HTTP stub form for it. On the API reference, an operation whose call leaves the page has a "Real service" tag beside Send.

The mock server guide's [routing section](https://github.com/codeforamerica/safety-net-blueprint/blob/main/docs/guides/mock-server.md#answering-in-a-page) shows a handler that forwards a call. A real service has to accept requests from the site's address (CORS).

Output is written to the `--content` directory as static HTML files. The API reference, state machine docs, event catalog, and data dictionaries update automatically as contracts change — rebuild after each resolve step.

## Changelog

See [CHANGELOG.md](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/blueprint-explorer/CHANGELOG.md) for release history.

## Documentation

See the [Safety Net Blueprint documentation](https://github.com/codeforamerica/safety-net-blueprint) for full guides and reference.

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
