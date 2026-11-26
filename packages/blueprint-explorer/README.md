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
| **API Reference** | Endpoint docs derived from resolved OpenAPI specs — parameters, request/response schemas, status codes, and links to related state machine transitions. Each operation shows its call as curl and through the generated TypeScript client, and with Try it on, sends it to the mock running in the page |
| **State Machine Docs** | Full state machine reference — states, transitions, guard conditions, actor restrictions, and event subscriptions per resource |
| **Event Catalog** | Cross-domain event index — every emitted event with its publisher, payload schema, and known subscribers |
| **Data Dictionaries** | Field-level reference derived from writable schemas — field names, types, policy citations, and data classifications |
| **Context Map** | Domain relationship diagram showing cross-domain data dependencies |
| **Scenarios** | The Arazzo scenarios, played a step at a time against the mock server running in the browser, built from the contracts. Works served or opened from disk. The mock's files go in `mock/`, shared by every page that runs it, and the records you make carry from page to page within a browser tab. Reloading a page starts again from the sample records. Set `first_tour` in `config.yaml` to choose the scenario it opens with |

Each API reference page with operations has a **Try it** switch at the top, which works like a browser's developer tools. Off, the page is the reference. On, each operation becomes its request, with Send and the response, and the Activity pane docks beside the page, or along the bottom of a narrow window. Under a response, a line says how many events the call set off and opens Activity at that request. Activity logs each request Try it sends, with its response and the events it set off; the timers waiting sit at the top, each with Fire. Clear empties the log. The records carry over from page to page in the browser tab, and a reload puts back the sample records. The switch holds for the tab.

The Scenarios page runs a mock of its own, so running a scenario never touches what you made with Try it. Picking a scenario, or Start over, starts it on a fresh mock with the sample records.

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

### A site's own content

A site built from the explorer, such as a developer portal, says what it is and who publishes it in `config.yaml`. Files it names are relative to `config.yaml`, and the build copies them into the site:

```yaml
name: AI Services
title: AI Services Developer Portal   # on the home page; "<name> Explorer" when omitted
tagline: APIs for the services Code for America runs for state benefits programs. **Try them in your browser.**
logo: logo.svg                 # in the header, in place of the Blueprint mark
organization:                  # in the footer; Code for America when omitted
  name: Code for America
  url: https://codeforamerica.org
pages: pages                   # a folder of the site's own pages
featured_links:                # under the tagline
  - label: Getting started
    href: pages/getting-started.html
  - label: Live transcription demo
    href: https://example.org/live-transcription
```

- **`tagline`** is a sentence or two of Markdown under the site's title. Without one, it's "Reference and tools for the *name* contracts."
- **`pages`** is a folder. Each Markdown page in it becomes an HTML page of the same name in the explorer's layout, titled by its first heading: links, code blocks and tables included. Anything else, an HTML page or an image, is used as it is. Link a page from `featured_links`.
- **`featured_heading`** puts a label before the featured links, such as "For state leadership". There's none by default.
- **`blueprint_pages: true`** adds the Blueprint's own pages for state leadership (executive summary, adoption model, architecture principles) under `authored/`. A site gets none of them otherwise.

### A site's routing

Name a routing file in `config.yaml`, relative to it, to send some operations to real services, or to code of the site's own, instead of the mock in the page:

```yaml
routing: routing.yaml
```

```yaml
# routing.yaml, in the mock server's routing format
routing:
  - api: communication-transcription-sessions-adapter
    match: { provider: aws-transcribe }
    handler: ./adapters/transcribe.js
```

A `handler` is a JavaScript module that exports a handler for each operation it answers, by operationId, as the mock server guide's [handlers](https://github.com/codeforamerica/safety-net-blueprint/blob/main/docs/guides/mock-server.md#handlers) describes. The build checks the routing against the contracts and fails, listing each problem, when it's wrong. It then bundles the file with the modules it names, and whatever they import, into `site-routing.js`, which every page loads after the site's own script, since a page opened from disk can't import a module.

### Environments

A site can switch between environments, as a developer portal switches between a sandbox and production. List them in `config.yaml`, the first being the default:

```yaml
environments:
  - name: Mock
    variables: ../environments/local.env
    routing: routing.yaml
  - name: Real
    variables: ../environments/production.env
    overlays: [../environments/production.overlay.yaml]
    routing: routing-production.yaml
    sign_in:
      client_id: my-portal
```

Each environment has its config: a `.env` file of `${VAR}` values, as `blueprint-resolve --env-variables` takes, and overlays, as `--env-overlay` takes, for what differs in shape, such as how callers sign in. Each also has its own routing, and its own sign-in client.

Build the site from contracts resolved without an environment, `blueprint-resolve --build`, which keeps the `${VAR}`s:

```bash
blueprint-resolve --spec=contracts --overlay=contracts/overlays --out=built --build
blueprint-build-explorer --spec=built --out=site --config=explorer
```

The reference pages show the first environment. With more than one, turning on Try it puts an environment menu in the page's header, beside sign-in; picking one reloads the page in it, with that environment's values, routing and sign-in applied in the browser, the release step of the Twelve-Factor App's build, release, run (https://12factor.net/build-release-run). Each environment keeps its own records and sign-in for the browser tab. Scenarios always run against the first.

### Signing in

When the environment's contracts have a security scheme that says how to sign in (OAuth 2.0's implicit or authorization code flow, or OpenID Connect), the Try it panel has Sign in, and a call that requires it asks you to sign in before it's sent, as Swagger UI's Authorize does. Signing in opens the provider's page in a popup, which returns to the site's `sign-in-return.html`. The token is kept for the browser tab and sent with each call that requires it. The site names the client it signs in as with `sign_in`:

```yaml
sign_in:
  client_id: my-portal
  scopes: [openid, profile]
```

With environments, put `sign_in` on each environment instead. An environment whose scheme is a header, such as the framework's default `X-Caller-Id`, has nothing to sign in to.

### A site's own script

Name a JavaScript file in `config.yaml`, relative to it, and every page loads it before the mock starts:

```yaml
script: portal.js
```

The script can send some APIs to real services by setting `BlueprintExplorer.routing`, in the mock server's routing format: a URL with `to`, or a `handler` function, such as one that adds the visitor's sign-in token. Every mock the explorer starts takes it, and with none, every call stays in the page.

```js
// portal.js
BlueprintExplorer.routing = [{
  api: 'communication-transcription-sessions-adapter',
  handler: async (request) => { /* add the token, then forward the call */ },
}];
```

On the API reference, an operation whose call leaves the page has a "Real service" tag beside Send.

The mock server guide's [routing section](https://github.com/codeforamerica/safety-net-blueprint/blob/main/docs/guides/mock-server.md#answering-in-a-page) shows a handler that forwards a call. A real service has to accept requests from the site's address (CORS).

Output is written to the `--content` directory as static HTML files. The API reference, state machine docs, event catalog, and data dictionaries update automatically as contracts change — rebuild after each resolve step.

#### Transcription session adapters

On the API reference, against the mock (the site's first environment, or a site with none), every adapter answers with its contract's example response, so each operation is one request and one response: a session's start returns with the session connecting, and nothing goes further. The Scenarios page shows the rest of the flow. In another environment, its routing answers the adapter, by the profile a session names.

An adapter is a module of routing handlers, named in the site's [routing](#a-sites-routing). The blueprint's harness site has one, [`packages/blueprint-harness/explorer/adapters/whisper.js`](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/blueprint-harness/explorer/adapters/whisper.js), which transcribes in the page with Whisper, with no service or account: the whole adapter, to copy into a site and to write one for another service from. A contract set offers it with a profile naming `whisper` in its config, and a site routes to it:

```yaml
# routing.yaml
routing:
  - api: communication-transcription-sessions-adapter
    match: { provider: whisper }
    handler: ./adapters/whisper.js
```

The library and models for Whisper come from jsDelivr and Hugging Face.

## Changelog

See [CHANGELOG.md](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/blueprint-explorer/CHANGELOG.md) for release history.

## Documentation

See the [Safety Net Blueprint documentation](https://github.com/codeforamerica/safety-net-blueprint) for full guides and reference.

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
