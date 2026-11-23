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

Every page but the authored ones has a **Try it** switch at the top, which works like a browser's developer tools. Off, an API page is the reference. On, each operation becomes its request, with Send and the response, and the mock's control panel docks beside the page, or along the bottom of a narrow window. The panel restarts the mock with the sample records or empty, adds stubs, and logs each request Try it and Scenarios send, with its response and the events it set off; the timers waiting sit at the top of the log, each with Fire. The switch holds for the browser tab.

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

The control panel lists the routing under "Server", and each entry has a switch between the real service and the mock in the page, for the browser tab: the mock restarts without that entry, keeping records and stubs. A call the mock can't answer itself, such as an adapter's, then needs a stub, and the panel offers the HTTP stub form for it. On the API reference, an operation whose call leaves the page has a "Real service" tag beside Send.

The reader can also choose a server for the tab, as Swagger's server list does: at the top of "Server", an environment the contracts' `servers` name by `description`, such as "Production server", which sends each API to its own server for it, or a URL they type, which takes every call, such as a local `blueprint-mock`. The site's own routing still wins, and a reload puts every call back in the page. Record pickers list the chosen server's records; Restart, Start empty and timers, which are the page's own, are hidden; and Scenarios asks once before running against a server that isn't this machine. A server has to allow calls from the site's address (CORS); a refused call says so. To list real servers, set them in an overlay ([overlay guide](https://github.com/codeforamerica/safety-net-blueprint/blob/main/docs/guides/overlay-guide.md#set-an-apis-servers)).

The mock server guide's [routing section](https://github.com/codeforamerica/safety-net-blueprint/blob/main/docs/guides/mock-server.md#answering-in-a-page) shows a handler that forwards a call. A real service has to accept requests from the site's address (CORS).

Output is written to the `--content` directory as static HTML files. The API reference, state machine docs, event catalog, and data dictionaries update automatically as contracts change — rebuild after each resolve step.

#### Transcription session adapters

A transcription session's start and resume, on the API reference, take audio: the microphone, a recording, or typed lines, which the page speaks with Kokoro, an open speech model loaded from a CDN the first time. Send sends the one call. The session then calls its adapter, which runs in the page through the site's routing, and the adapter streams the audio and publishes the session's events — connected, each line, ended — which the session and the transcript follow. The adapter's calls and events show in the activity log.

An adapter hears audio as it would in an app, by asking the browser for the microphone (`getUserMedia`). When the reader chose a recording or typed lines, Try it answers the adapter's next request for the microphone with a stream playing them, aloud too, so you hear what the adapter hears.

An adapter is a module of routing handlers, named in the site's [routing](#a-sites-routing). The blueprint's harness site has one, [`packages/blueprint-harness/explorer/adapters/whisper.js`](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/blueprint-harness/explorer/adapters/whisper.js), which transcribes in the page with Whisper, with no service or account: the whole adapter, to copy into a site and to write one for another service from. A contract set offers it with a profile naming `whisper` in its config, and a site routes to it:

```yaml
# routing.yaml
routing:
  - api: communication-transcription-sessions-adapter
    match: { provider: whisper }
    handler: ./adapters/whisper.js
```

The libraries and models for Whisper and Kokoro come from jsDelivr and Hugging Face. A site that hosts them itself distributes Kokoro's speech-sound step, eSpeak NG, which is GPL-3.

## Changelog

See [CHANGELOG.md](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/blueprint-explorer/CHANGELOG.md) for release history.

## Documentation

See the [Safety Net Blueprint documentation](https://github.com/codeforamerica/safety-net-blueprint) for full guides and reference.

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
