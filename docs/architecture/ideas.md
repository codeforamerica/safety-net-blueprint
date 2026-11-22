# Ideas

Possibilities for the mock server and the explorer that nobody is working on. They're kept here so they aren't lost. When someone takes one up, it becomes an issue, and its entry here is removed.

## The explorer

### Try it

- **Save and load records.** Download what the mock holds as a file, and load one back, including a mock-data YAML file. Useful for demos: set up a state once and start from it later. The event log would come along as history, without the events happening again; event stubs wouldn't. With it, a `--seed=<dir>` option on `blueprint-build-explorer` could build a set of records into the site, as the mock server's `--seed` does.
- **A minimal body for creates,** with only the required fields. Today the Example list offers each sample record, trimmed to what the request accepts.
- **Links to the scenarios an API is used in.** An operation's page, or a WebSocket API's, would list the scenarios with a step that calls it or sends or receives its messages, found from the scenarios rather than written in, each linking to the Scenarios page (`#tour=<path>`). Try it stays free to call anything in any order, and the scenario shows the order things go in, such as connecting to a relay, sending `start`, then the audio, then `end`.

### Beyond Try it

- **One reference for operations, behavior and events.** An operation's card would show what happens behind it: the transition it runs, the guards that can refuse it, the events it publishes and who subscribes. With Try it on, the same things appear in the log as they happen. The state machine docs and the event catalog would become views of that one reference rather than tools of their own.
- **State machines you can walk.** The diagram is already generated. Clicking a transition could move a record, and an illegal one could be refused, so the page for `close` shows the 409 rather than describing it.
- **Compositions previewed.** The assembled shape exists in no schema, so today the page can only describe it. The page could show one built from the sample records.
- **Annotations with a value beside them.** Click a field and see the citation it carries and a value a transition just wrote.
- **Edit and reboot.** Change a transition's `from` state or an income threshold, rebuild the mock in the page, and watch the documented behavior change. A rebuild takes about 12 to 22 ms. For a policy analyst, that turns the documentation into a sandbox.
- **An embedded prototype.** A working intake flow running against the documented contracts, for adoption conversations. Code that runs unmodified, making ordinary `fetch` calls, would need the calls intercepted, with MSW. A Service Worker can't register on `file://`, so this needs a served explorer.

## Where the mock server could run

`createMockServer({ contracts })` returns a `fetch` with `fetch`'s own signature, so running the mock doesn't have to mean a Node process listening on a port.

- **As a test library.** `createMockServer()` and `vi.stubGlobal('fetch', mock.fetch)` in Vitest or Jest: no port, no server to start or stop. This works today. Stubbing the global `fetch` only reaches code that calls `fetch`; the generated clients use axios, so they're given the mock instead: `createClient({ baseURL, adapter: 'fetch', env: { fetch: mock.fetch } })`.
- **On a CDN, as static files.** `index.html`, the bundle and the contract set. The mock runs in each visitor's tab with its own store, so there's no shared state and no compute to pay for. The API exists only in that tab; nothing on another machine can call it.
- **Serverless, as a request handler.** Cloudflare Workers, Deno Deploy and Vercel Edge take `(Request) => Response` directly. AWS Lambda needs a short adapter between its event shape and `Request`. The real work is state: invocations don't share memory, so a store backed by something outside the process is needed (the store seam in `packages/blueprint-mock-server/src/stores/`).
- **One Durable Object per session.** Each person gets a stateful mock at an address: "here's a live API seeded with my scenario, open it." That lets an agency and a vendor look at the same behavior, which is the hard part of contract work.
- **Inside a Service Worker, as an app's own backend,** so an application works with no network at all: an offline demo.
- **In a WebContainer.** StackBlitz's `@webcontainer/api` runs Node in the browser, so the unmodified Node server could run from a link, with a terminal and no install.

Notes for any of these:
- `better-sqlite3` isn't available on Workers, so the memory store is the only option there until a WASM store exists.
- The event stream (`/platform/events/stream`) holds a `ReadableStream` open. Workers handle that; API Gateway cuts it off after 29 seconds, though Lambda Function URLs support streaming.
- The event bus lives in one process, so events published in one instance never reach a stream in another. Running several instances needs real publish/subscribe.

### Packages worth evaluating

- **`node:sqlite`.** Node 22 has SQLite built in. Replacing `better-sqlite3` would remove the package's only native module, the biggest obstacle to running the Node server anywhere unusual.
- **`@sqlite.org/sqlite-wasm` or `wa-sqlite`.** SQLite in a page, saved to the browser's private file system (OPFS), so records survive a reload. It fits the store seam.
- **PGlite.** Postgres compiled to WASM, which runs in Node and the browser: the same engine on both sides, if a Postgres store ever happens.
- **`undici`'s `MockAgent`.** Node's own `fetch` interception, the Node counterpart to MSW, with no service worker.
- **`itty-router`.** A small `fetch`-native router, if the hand-written route matcher ever stops paying for itself.

Not recommended: `@mswjs/data`. It overlaps the store seam and would mean taking on another project's data model for something the contracts already define.

## Resolving contracts

- **Declare a set's servers once.** Every API declares its own `servers`, so pointing a set at where it really runs means an overlay action per API file, repeated whenever an API is added. Most sets follow one pattern: a base address plus each API's path. One block in an overlay's `config:`, beside the other set-wide options, could say it once, with `{domain}` and `{api}` filled in for each API, as OpenAPI server URLs already fill in their variables:

  ```yaml
  config:
    x-servers:
      - description: Production server
        url: https://api.state.gov/{domain}        # or https://{domain}.api.state.gov
      - description: Production server
        apis: [communication-transcription-sessions-adapter]
        url: https://adapter.vendor.com            # an API that runs somewhere else
  ```

  Resolve would write each API's `servers` from the narrowest entry matching it for each description, as routing picks its narrowest entry, so the contracts, generated clients, docs and the explorer's server menu agree. An entry could also name domains or capabilities: the AI services run by different teams each have their own address. OpenAPI has no servers for a whole set, so `x-servers` would be the blueprint's own.
