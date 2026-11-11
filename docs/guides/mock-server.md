# Mock Server

Development server that serves REST APIs from OpenAPI specs and behavioral contracts (state machines, rules, metrics). Everything is generated from contracts at startup — there is no hand-written endpoint code.

## Quick Start

```bash
npm run mock:start    # Start server (port 1080)
```

```bash
curl http://localhost:1080/health
# → { "status": "ok", "apis": ["intake", "workflow", ...] }
```

## What gets served

**REST endpoints** — generated from each OpenAPI spec (`*-openapi.yaml`): list, get, create, update, delete. Requests are validated against schemas; errors return the shared error shape. An id in a create or update whose field declares `x-relationship` must name a record the mock holds, in any domain, or the write is refused with a `422` naming the field. Ids marked `External` or `Polymorphic`, and ids into a collection forwarded to a real service, aren't checked.

**RPC endpoints** — generated from state machine files (`*-state-machine.yaml`): one `POST /{domain}/{resource}/:id/{operation}` per transition. The server enforces valid state transitions (409 on invalid), evaluates guards, executes steps, tracks SLA clocks, and fires domain events.

**Metrics endpoints** — generated from metrics files (`*-metrics.yaml`): `GET /{domain}/metrics` and `GET /{domain}/metrics/{id}`, computed on-the-fly from live data.

**Registry endpoints** — `GET /platform/registry` lists the registry types the contracts declare, and `GET /platform/registry/{type}` and `/platform/registry/{type}/{entryId}` read their entries, straight from the `*-registry-{type}.yaml` files. Files of one type combine; an entry id two of them define stops the mock from starting.

**Rules endpoints** — one `POST` per ruleset, at `/{domain}` and the path the ruleset declares. See the [rules guide](rules-guide.md#endpoints).

Each route has one source. A transition, composition or ruleset is served from the contract that produced it; the operation resolve generated for it in an OpenAPI document only documents it. Two documents declaring the same route stop the mock from starting, with an error naming both — and `validate` reports any route two contracts claim before that, including two in the same file.

Adding a new operation or resource requires only a contract change.

## Seed data

At startup, the server populates its databases from two sources:

- **Seed files** — `*-mock-data.yaml` files discovered recursively under the directory passed to `--seed`. Each declares its domain with a top-level `domain`; every other key is a record, routed to a collection by key-prefix matching (e.g. `TaskExample1` → `tasks`). Without `--seed`, all collections start empty.
- **Config files** (`*-config.yaml`) — catalog entries like queues, services, and document types that the server treats as system-managed records. These are always loaded from the spec directory regardless of `--seed`.

The safety-net-contracts package ships hand-authored `*-mock-data.yaml` files alongside each domain's specs (e.g. `domains/workflow/workflow-mock-data.yaml`). To use them:

```bash
npm run mock:start -- --seed=packages/safety-net-contracts
```

To generate a fresh set of faker-based seed files from the current schemas:

```bash
npm run mock:seed   # writes *-mock-data.yaml files to packages/generated/mock-data/
```

Then start the server pointing at the generated output:

```bash
npm run mock:start -- --seed=packages/generated/mock-data
```

The generated files are gitignored. The hand-authored files in `domains/*/` are committed and represent the canonical dev dataset. `mock:seed` is a bootstrap tool — useful when adding a new domain or when you want a valid starting point after significant schema changes. It overwrites whatever is in `--out`.

**`POST /mock/reset`** clears all runtime data and restores the config-managed catalog entries. It does not reseed from the seed files — you get an empty database plus the catalog. Use it at the start of each integration test suite to start from a clean, known state.

```bash
curl -X POST http://localhost:1080/mock/reset
```

### Time tokens in seed files

Seed files support `$now` tokens in date and datetime fields so that fixtures stay current regardless of when the server starts.

| Token | Resolves to |
|-------|-------------|
| `$now` | Server start time T |
| `$now-P30D` | T − 30 days |
| `$now+P7D` | T + 7 days |
| `$now+PT8H` | T + 8 hours |
| `$now+P1M` | T + 1 calendar month |
| `$now+P2D@09:30` | T + 2 days, local time pinned to 09:30 |
| `$now@17:00` | Today, local time pinned to 17:00 |

The offset is `+` or `-` and an ISO 8601 duration, in whole numbers. `M` is months before the `T` and minutes after it: `$now+P1M` is a month away, `$now+PT30M` half an hour — so `$now+P30M` is 30 months. A month past the end of the next lands on its last day: January 31 + `P1M` is February 28. The `@HH:MM` pin sets the time of day in local server time.

The old offsets — `$now+7d`, `$now+8h`, `$now+30m`, `$now+1w` — still resolve, with a warning naming the ISO form, and will be removed in a later release.

All tokens in a single seed load resolve against the same instant, so relative timestamps within a fixture are internally consistent.

Malformed tokens (e.g. `$now+7dasys`) cause the server to exit with an error rather than writing the raw string to the database.

```yaml
AppointmentExample1:
  id: 7e1c6f9a-0000-0000-0000-000000000001
  startAt: "$now+P1D@09:30"
  endAt: "$now+P1D@10:00"
  status: scheduled
```

You can also use `$now` tokens in event stub `response.data` fields — there, the time is calculated when the stub fires, not when the server started.

## Caller context

State machine operations use two headers to identify who is making the request:

| Header | Description |
|--------|-------------|
| `X-Caller-Id` | ID of the acting user (used in `$caller.id` expressions, e.g., to assign a task to the claiming worker) |
| `X-Caller-Roles` | Comma-separated roles (e.g., `caseworker,supervisor`). Operations with actor restrictions return 403 if none of the caller's roles match. Changing a field marked `readOnly` gets 422, whatever the roles: only the server's own calls, a state machine acting as the system, may set one. |

```bash
curl -X POST http://localhost:1080/workflow/tasks/<id>/claim \
  -H "X-Caller-Id: 00000002-0000-0000-0000-000000000001" \
  -H "X-Caller-Roles: caseworker"
```

**Response codes from RPC endpoints:**
- `403` — the caller's roles don't satisfy the operation's actor requirements
- `409` — the resource is in the wrong state for this transition, or a guard condition failed
- `422` — the request body failed schema validation

## Domain events

### Watching the event stream

Subscribe to live events as they fire:

```bash
curl -N http://localhost:1080/platform/events/stream
```

Each message is a Server-Sent Events frame with the full CloudEvents 1.0 envelope as JSON.

### Firing events

There are two ways to fire an event into the bus:

**`POST /platform/events`** — fire a full CloudEvents 1.0 envelope directly:

```bash
curl -X POST http://localhost:1080/platform/events \
  -H "Content-Type: application/json" \
  -d '{
    "specversion": "1.0",
    "type": "org.codeforamerica.safety-net-blueprint.data-exchange.call.completed",
    "source": "/data-exchange",
    "subject": "<service-call-id>",
    "data": { "result": "conclusive", "serviceType": "fdsh_ssa" }
  }'
```

**`POST /mock/stubs/events`** — a convenience wrapper around `POST /platform/events`. You only specify the delta; the stub engine builds the full envelope and posts it to the platform for you. See [Event stubs](#event-stubs) below.

## Event stubs

An event stub is a convenience wrapper around `POST /platform/events`. Instead of constructing the full CloudEvents envelope yourself, you specify the event type and just the fields that differ — the stub engine fills in the rest.

When any event fires, the engine scans registered stubs in order (FIFO) and pops the first one whose `on` and `match` criteria fit. If nothing matches, the event fires normally.

```bash
curl -X POST http://localhost:1080/mock/stubs/events \
  -H "Content-Type: application/json" \
  -d '{
    "on": "data-exchange.external_service_call.created",
    "match": { "data.serviceType": "fdsh_ssa" },
    "response": {
      "type": "data-exchange.call.completed",
      "data": { "result": "inconclusive" }
    }
  }'
```

- `on` — the CloudEvents type suffix to match, with no platform prefix (`data-exchange.external_service_call.created`)
- `match` — optional dot-path field matchers against the event envelope; all must match
- `response.type` — the event type to fire when matched
- `response.data` — merged with the trigger event's data; only specify what changes

The response envelope is built by merging: an entity ID derived from the trigger's `subject`, named for the trigger's resource (e.g., `externalServiceCallId`), the trigger event's data, then `response.data` overrides. The fired event's `causationid` is set to the trigger event's `id`, so a scenario can fetch the response for a specific trigger with `GET /platform/events?causationid=<trigger event id>`.

**Stub IDs** are human-readable, from the last two segments of `on`: `external_service_call.created-1`, `external_service_call.created-2`, etc.

### Timer stubs

Timer stubs are a variant for `platform.timer.requested` events. The callback event type and data are embedded in the triggering event itself, so no `response` block is needed — the stub engine reads them directly.

```bash
# Register a stub for creation_deadline timers
curl -X POST http://localhost:1080/mock/stubs/events \
  -H "Content-Type: application/json" \
  -d '{
    "on": "platform.timer.requested",
    "match": { "data.callback.event": "workflow.creation_deadline" }
  }'

# Create a task — task creation schedules the timer, stub fires it immediately
curl -X POST http://localhost:1080/workflow/tasks \
  -H "Content-Type: application/json" \
  -H "X-Caller-Id: 00000002-0000-0000-0000-000000000001" -H "X-Caller-Roles: caseworker" \
  -d '{"name":"Test","taskType":"application_review","subjectType":"application","subjectId":"00000000-0000-0000-0000-000000000001"}'

# Task should now be escalated
curl http://localhost:1080/workflow/tasks/<id> | jq .status
# → "escalated"
```

Match on `data.callback.event` — the event type embedded in the scheduling request. Omit `match` to match any timer request regardless of type.

### Managing event stubs

```bash
curl http://localhost:1080/mock/stubs/events                                             # list all
curl -X DELETE http://localhost:1080/mock/stubs/events/external_service_call.created-1   # remove one
curl -X DELETE http://localhost:1080/mock/stubs/events                                   # clear all
```

## HTTP stubs

An HTTP stub intercepts a request to any mock server endpoint before normal handler logic runs — no database read, no state machine evaluation, just the stub response. Stubs are consumed FIFO: register one per call you expect, then verify it was consumed.

Use HTTP stubs to simulate adapter calls that the state machine triggers internally (e.g., a SNAP expedited screening adapter call triggered by `eligibility.decision.created`).

```bash
# Register a stub
curl -X POST http://localhost:1080/mock/stubs/http \
  -H "Content-Type: application/json" \
  -d '{
    "match": {
      "method": "POST",
      "domain": "eligibility-adapter",
      "url": "/evaluate/expedited-screening"
    },
    "response": {
      "status": 200,
      "body": { "expedited": true }
    }
  }'
# → 201 { "id": "http.expedited-screening-1", "type": "http", ... }
```

**`match` fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `url` | yes | Request path. With `domain`, this is relative to the domain (e.g., `/evaluate/expedited-screening`). Without `domain`, it is the full request path. |
| `domain` | no | API domain prefix (e.g., `eligibility-adapter`). When set, the effective match path is `/<domain><url>`. Use this to scope a stub to a specific domain when multiple domains share the same endpoint path. |
| `method` | no | HTTP method (e.g., `POST`). Omit to match any method. |

**`response` fields** (optional — defaults to 200 `{}`):

| Field | Default | Description |
|-------|---------|-------------|
| `status` | 200 | HTTP status code |
| `body` | `{}` | JSON response body |

**DELETE stubs** default to `status: 204` with no body.

A stub intercepting a procedure's create, as below, only has to match: the create is suppressed and its `response` is never read.

Both kinds of stub are checked against `packages/blueprint-mock-server/schemas/stubs-schema.json` when registered. A key the schema does not name is rejected with a `422` naming it, rather than being kept and silently ignored.

**Verifying consumption:** after the flow that triggers the adapter call, `GET /mock/stubs/http` should return an empty list.

```bash
# 1. Register stub before triggering the flow
curl -X POST http://localhost:1080/mock/stubs/http \
  -d '{"match": {"method": "POST", "domain": "eligibility-adapter", "url": "/evaluate/expedited-screening"}}'

# 2. Trigger the flow (SNAP application creates a Decision → fires eligibility.decision.created
#    → evaluateSnapExpedited procedure → POST /eligibility-adapter/evaluate/expedited-screening)
curl -X POST http://localhost:1080/platform/events \
  -d '{"specversion":"1.0","type":"org.codeforamerica.safety-net-blueprint.intake.application.submitted","source":"/test","subject":"app-123","data":{"programs":["snap"]}}'

# 3. Verify stub was consumed
curl http://localhost:1080/mock/stubs/http
# → { "items": [], "total": 0 }
```

### Managing HTTP stubs

```bash
curl http://localhost:1080/mock/stubs/http                                       # list all
curl -X DELETE http://localhost:1080/mock/stubs/http/http.expedited-screening-1  # remove one
curl -X DELETE http://localhost:1080/mock/stubs/http                             # clear all
```

## Routing to a real service

Routing hands a domain, an API or a single operation to something other than the mock — a real service at a URL, or a function a page passes in — while everything else stays mocked. It is how a state connects its backend one domain at a time without leaving the mock environment, and how a page with no backend answers an operation itself.

```yaml
# routing.yaml — per environment; keep it out of the contracts directory
routing:
  - domain: intake
    to: https://intake.state.example.gov
    includeHeaders: [Authorization]
  - api: intake-rules
    to: http://localhost:4000
    timeoutMs: 5000
  - domain: communication
    except: [{ api: communication-transcripts }]
    to: https://communication.state.example.gov
```

```bash
npm run mock:start -- --spec=<contracts> --routing=routing.yaml
```

In a page, pass the same entries to `createMockServer({ contracts, routing })`, or to `createMockClient`, which keeps a page's own APIs and sends the rest to the server with a `*` entry (the [mock's README](../../packages/blueprint-mock-server/README.md#a-client-and-a-server)). Both are checked against [`schemas/routing-schema.json`](../../packages/blueprint-mock-server/schemas/routing-schema.json).

| Field | |
|---|---|
| `domain` | Every route the domain's APIs declare, state machine actions included, and every event their state machines receive. Named by its directory under `domains/`, or `*` for every domain, which also answers any request the mock has no route for. |
| `api` | One API's routes and received events. Named by its OpenAPI file's name without `-openapi.yaml` — `intake`, `communication-transcripts` — which its events AsyncAPI shares. |
| `operation` | One operation, by its id: an OpenAPI `operationId`, or an AsyncAPI `receive` operation's. Bare when one API declares it; `$apis.<api>.<id>` when more than one does. |
| `except` | What stays in the mock, inside the entry: `{ api }` or `{ operation }` on a domain, any of them on `*`, `{ operation }` on an API. Not on an operation entry. |
| `to` | The service's base URL. For a request, its path is a prefix: `https://host/api` serves `/intake/applications` at `https://host/api/intake/applications`. It may not carry a username or password. |
| `handler` | A function that answers instead, `(request) => response` — `fetch`'s signature, as an [MSW](https://mswjs.io/) resolver has. Code only, so a page can pass one and a file can't. |
| `includeHeaders` | Headers to pass along beyond the defaults, below. |
| `timeoutMs` | How long to wait before answering `504`. Defaults to 10000. |

Each entry names exactly one of `domain`, `api` or `operation`, and one of `to` or `handler`. When entries overlap, the narrowest answers: an operation over an API, an API over a domain, a domain over `*`, whichever is listed first. The server refuses to start when an entry names nothing the contracts declare, names the same thing twice, names an operation more than one API declares without qualifying it, names a `send` operation — an API sends its own events — has an `except` outside it, or carries a key the schema does not.

**Prefer a domain to an operation.** A routed operation answers from the real service's data while the rest of its domain answers from the mock's, so a record the real service creates is invisible to the mocked reads beside it. Routing the whole domain keeps them together.

### Answering in a page

A page with no backend — a live demo running in the browser — answers an operation with a `handler`. A transcript's `get-connection` action calls the transcript audio adapter's `issueTranscriptConnection`, which a state runs to issue a transcription service's short-lived credential. A demo that gets one from Amazon Cognito instead answers that operation in the page, echoing the request's `metadata` as every adapter does:

```js
const mock = await createMockServer({
  contracts,
  routing: [{
    operation: 'issueTranscriptConnection',
    handler: async (request) => {
      const { metadata, ...asked } = await request.json();
      return Response.json({ metadata, ...await connectionFromCognito(asked) });
    },
  }],
});
```

A test answers it with an [HTTP stub](#http-stubs) on `POST /issue-connection` instead, as the harness's transcript scenario does.

What a handler answers is checked against the operation's response schema. One the schema doesn't allow is answered `502`, naming what is wrong, and logged, so a broken handler shows at once.

### Events a routed domain receives

Routing a domain or API also covers the events its state machines react to — its `receive` operations, in the events AsyncAPI resolve generates. The mock doesn't run those reactions; it delivers the event to whoever answers instead, so a real workflow service hears that the mock's intake submitted an application. The delivery is the [CloudEvents HTTP binding](https://github.com/cloudevents/spec/blob/main/cloudevents/bindings/http-protocol-binding.md)'s structured mode:

```http
POST https://workflow.state.example.gov
Content-Type: application/cloudevents+json
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01

{ "specversion": "1.0", "type": "intake.application.submitted", "source": "/intake", "subject": "…", … }
```

It goes to `to` as written — CloudEvents defines no path, so it is the URL a webhook would be — or to a `handler` as that same request. An event is delivered once to each routed `receive` operation, however many of the API's machines react to it. A delivery that fails is logged and dropped; the mock has no queue to retry from.

### Events a routed domain sends

The other way round: when a state machine the mock keeps reacts to an event a routed API sends — a transcription session in a page following its transcript on the server — the mock reads that service's events and handles each as `POST /platform/events` would. It reads them the ways the platform contract offers, through the same `to` or `handler`:

- `GET /platform/events/stream`, filtered to the events it needs, reconnecting with `Last-Event-ID` after a drop so nothing is missed;
- `GET /platform/events`, polled every few seconds, when the service has no stream and answers `404`, `405` or `501`.

It starts on its own when the mock is built, one reader per service, and logs `EVENTS <types> from <service>`. An event the mock already has — one it sent there itself — is skipped, and one that arrives isn't delivered back. In a page, `mock.stopFollowing()` stops reading.

Each mock keeps its own events, reactions and stubs, so a page can build one for itself and another standing in for the server, and route the first to the second's `fetch` with a `handler`.

### Headers

Only headers that describe the request are passed on by default: `Accept`, `Accept-Language`, `Content-Type`, `If-Match`, `If-None-Match`, `Idempotency-Key`, `traceparent` and `tracestate`. Everything else, credentials included, is dropped unless `includeHeaders` names it — so a service that needs the caller's token gets it only with `includeHeaders: [Authorization]`.

The same list governs what comes back: the real service's `Set-Cookie` reaches the caller only if `includeHeaders` names it. The service's own CORS headers never do.

The mock attaches no credential of its own. Where the target needs one, it is either the caller's — a user's bearer token, named in `includeHeaders` — or the target holds it, as an adapter in front of a vendor system does.

### What comes back

The real service's status, headers and body, unchanged except as above. A target that cannot be reached answers `502`, one that is too slow `504`, and a redirect is refused with a `502` naming where it pointed — the mock sends requests only to the targets the configuration names.

An [HTTP stub](#http-stubs) still outranks a routed route: registered on one, it answers in the service's place, once, and the next request is routed.

### In a browser

A page holds no secrets, so a route to a service from a page can reach only one that accepts a user's own credential, or none:

- **CORS.** The target must allow the page's origin. A third-party service usually does not.
- **No shared credentials.** A system credential for a federal data service cannot be in a page. Route to an adapter that holds it — run locally by the person using the page, or hosted — or answer with a `handler` that gets a short-lived credential for the person, as the Cognito example does.

### What routing does not reach

- **Calls a state machine makes by path.** A call by `operationId` goes through the route table, so it is routed; a call written as a method and path is carried out inside the mock and is not. A machine uses one only for its own domain's records, which are routed with its reactions; `validate` warns about one into another domain.
- **The real service's events nothing here reacts to.** The mock reads only the events its own machines need ([above](#events-a-routed-domain-sends)). A service can publish others to it at `POST /platform/events`.

## Scenarios

A scenario is a sequence of calls toward a goal, written as an [Arazzo](https://spec.openapis.org/arazzo/) document — the OpenAPI Initiative's format for API workflows. Each step names an operation in the contracts by its `operationId`, what it sends, what makes it a success, and what it carries to later steps. A scenario is a contract like any other: a file ending `.arazzo.yaml`, anywhere in the contract set, declaring its domain in `info.x-domain`. `validate` checks that every step calls an operation the set has, refers only to earlier steps, and names only actors the scenario lists in `info.x-actors` (extensions.yaml).

The same file runs as a test, is one of the walkthroughs in the demo page's Show me around, drawn a step at a time, and runs against a real implementation with any Arazzo runner, such as Redocly's Respect. The mock's own runner, `runScenario` from `@codeforamerica/blueprint-mock-server/browser`, runs the subset the blueprint's scenarios use and refuses anything else by name, so a scenario never passes by not being checked:

- steps by `operationId`, with `parameters` (path, query, header) and `requestBody.payload` — sent as JSON, or for an upload as `multipart/form-data`, where a part the operation declares as a file is given as `{ fileName, contentType, content }`
- reusable parameters, `{ reference: $components.parameters.<name> }`
- runtime expressions — `$statusCode`, `$response.body#/<pointer>`, `$response.header.<name>`, `$steps.<id>.outputs.<name>`, `$inputs.<name>` — whole, or embedded in a string as `{$…}`
- selectors (Arazzo 1.1), `{ context, selector, type }`, in outputs, parameter values and request bodies — `type: jsonpath` to pick items out of a list by what they hold, `type: jsonpointer` for a value at a fixed place. A JSONPath's shape follows the query, as RFC 9535 sorts them: one made only of names and indexes (`$.items[0].id`) gives that value, and fails the step when it isn't there; one with a filter or a wildcard (`$.items[?@.status == 'proposed'].id`) gives a list, which may be empty. To use one item of such a list later, select `/0` from it with a JSON Pointer
- `successCriteria` comparisons joined by `&&`, and `jsonpath` conditions, which pass when they match anything; and `outputs`
- workflows that depend on earlier ones, `dependsOn`, reading what they produced as `$workflows.<id>.outputs.<name>` — a long scenario in sections, one workflow each, on the same mock throughout; the demo page heads each section with its workflow's `summary`
- `onFailure` actions of type `retry`, with `retryAfter` in seconds and `retryLimit` — for a step checking what the mock does after it answers, such as a state machine's reaction to an event, which may not have run the moment the step before it returns
- `startScenario`, which runs a scenario a step at a time on the same server, as the demo page's tours do; `runScenario` runs it through, or `until` a given step
- more than one source, with each step's operation qualified as `$sourceDescriptions.<name>.<operationId>`, as Arazzo requires

A scenario can call the mock's own routes too — registering a stub that stands in for a scheduler, say. Name `https://blueprint.codeforamerica.org/mock/mock-openapi.yaml` as a source and call its operations by the operationIds in `contracts/mock-openapi.yaml`; `controlOperations(mock)` gives them to the runner. Such a scenario runs against the mock only, and `validate` leaves the source's operations to the runner, which checks them where they are served.

```js
import { createMockServer, runScenario, operationIndex, controlOperations } from '@codeforamerica/blueprint-mock-server/server';
import { extract } from '@codeforamerica/blueprint-core/browser';

const mock = await createMockServer({ contracts });
const docs = extract(contracts, 'docs');
const scenario = docs.find((doc) => doc.type === 'arazzo');
const operations = new Map([...operationIndex(docs), ...controlOperations(mock)]);
const [workflow] = await runScenario(scenario.content, { fetch: mock.fetch, operations });
workflow.passed; // and workflow.steps: each request, response and check
```

A failed step stops its workflow, since later steps would act on what it did not produce.

A step's `description` is CommonMark: its first paragraph is the step's title, and a bullet list after it is what the demo page shows under What to notice. Any Arazzo tool shows the same text. A name in backticks in those bullets links to where the contracts declare it, shown when you hover or tap it. That works for the step operation's own parameters, fields and responses, and across the set for actions, procedures, reactions (by the event they listen for), rulesets, facts, compositions, SLA types, registry entries and schemas. A workflow's `description` is shown under its section's heading, in the same form.

## The mock's own endpoints

The routes the mock serves itself — `/health`, the stub endpoints, `/mock/reset` and `/mock/reseed` — are described in [`contracts/mock-openapi.yaml`](../../packages/blueprint-mock-server/contracts/mock-openapi.yaml), whose request bodies reference the stub schema. Show it in Swagger beside a contract set by passing `--spec` twice:

```bash
npx blueprint-swagger --spec=./resolved --spec=node_modules/@codeforamerica/blueprint-mock-server/contracts
```

It is for reading, not for the mock: passed to `blueprint-mock` as a contract, it declares routes the mock already serves, and the server refuses to start.

## Record shape on create

When the mock stores a newly created resource, it applies the following defaults to fields not present in the request body:

| Field type | Default behavior |
|---|---|
| Required + nullable (`type: [X, "null"]`) | Initialized to `null` |
| Required + array (`type: "array"`) | Initialized to `[]` |
| Optional (not in `required`) | **Omitted** — not present in the stored record |

**Why optional fields are omitted, not null:** `null` and absent are semantically distinct in OpenAPI 3.1 / JSON Schema. A field typed as `string` (non-nullable) cannot validly hold `null` — only a field typed as `["string", "null"]` can. Emitting `null` for an optional non-nullable field produces a spec-invalid response that breaks generated validators (e.g. Zod `.optional()` rejects `null`; only `.nullable()` accepts it). Omitting the field is the only spec-valid representation of "not provided."

This aligns with Stripe's behavior (they emit `null` for unset fields, but mark those fields `nullable` in their spec) and the Zalando REST guidelines (which treat null and absent identically only when a field is both optional *and* nullable).

The same rule applies wherever a state machine's value expression fills something in: a call's body, an event's data, an action's response or a `set:`. An expression that finds nothing leaves its field out, and a `null` is left out where the schema it goes into doesn't accept one. The rule is in [`docs/conventions/resources.yaml`](../conventions/resources.yaml), under `null_and_absent`.

## Sorting (`?sort=`)

The mock server honors the `x-sortable` extension on every list endpoint:

```bash
curl "http://localhost:1080/workflow/tasks?sort=-priority,dueDate"
```

Mock-specific behavior:

- Endpoints without `x-sortable` reject any `?sort=` with `400 INVALID_SORT_FIELD` — the parameter is not silently ignored.
- When the spec omits `maxFields`, the mock server applies an implicit ceiling of 5.
- Null values sort last on ascending order, first on descending.

For the full sort syntax, error codes, and adapter implementation guidance, see [Search Patterns — Sorting](search-patterns.md#sorting).

## Configuration

```bash
MOCK_SERVER_HOST=0.0.0.0 MOCK_SERVER_PORT=8080 npm run mock:start
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run mock:start` | Start server (databases empty without `--seed`) |
| `npm run mock:start -- --seed=<dir>` | Start server and seed from `*-mock-data.yaml` files under `<dir>` |
| `npm run mock:start -- --store=memory` | Hold resources in memory instead of SQLite — nothing written to disk, no native module |
| `npm run mock:start -- --spec=contracts.json` | Start from a bundled contracts artifact instead of walking a directory |
| `npm run mock:start -- --routing=<file>` | Route domains, APIs or operations to a real service — see [Routing](#routing-to-a-real-service) |
| `npm run mock:seed` | Generate faker-based seed files into `packages/generated/mock-data/` |

| Endpoint | Description |
|---------|-------------|
| `POST /mock/reset` | Clear runtime data; restore config-managed resources |
| `POST /mock/reseed` | Insert seed records again, clearing nothing |
| `POST /mock/stubs/events` | Register an event stub |
| `GET /mock/stubs/events` | List active event stubs |
| `DELETE /mock/stubs/events/:id` | Remove a specific event stub |
| `DELETE /mock/stubs/events` | Clear all event stubs |
| `POST /mock/stubs/http` | Register an HTTP stub |
| `GET /mock/stubs/http` | List active HTTP stubs |
| `DELETE /mock/stubs/http/:id` | Remove a specific HTTP stub |
| `DELETE /mock/stubs/http` | Clear all HTTP stubs |

## Troubleshooting

**Port in use:**
```bash
lsof -ti:1080 | xargs kill
```

**Stale or wrong data:**
```bash
curl -X POST http://localhost:1080/mock/reset
```

**Search not working:** Check that the seeded examples have non-empty string fields to search against.
