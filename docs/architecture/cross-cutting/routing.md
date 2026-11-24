# Routing

Where each domain, API and operation is answered in one deployment. The rules
are in
[`docs/conventions/patterns/routing.yaml`](../../conventions/patterns/routing.yaml);
this doc says why each one is there.

## Configuration, not a contract

A contract says what an API is: its operations, its data, its events, its
behavior. Routing says where each operation is answered: in the page, by a
state's service at a URL, by code a site supplies. The same contracts run
entirely in a page for a demo, against a state's servers in production, and
against staging in between, so where they run can't be part of them. A state
overlays the blueprint's contracts, but its server addresses, and which vendor
it pays for, are its own.

Routing still gets what any configuration a person writes should: a published
schema, [`schemas/routing-schema.yaml`](../../../packages/blueprint-core/schemas/routing-schema.yaml)
in blueprint-core, and validation against the contracts it routes. Every
domain, API, operation and `except` it names must exist; a `match` must name a
field of a request it routes, with a value that field allows; each entry has
one answer. `blueprint validate --routing=<file>` runs the checks, and so do
the mock server and the explorer's build, with the same messages, so a typo
fails before anything runs rather than on a call.

## Who uses the format

The blueprint's own runtime reads it: the mock server, the explorer, and an
app that runs the mock in its page. A state's own services don't: they route
with the infrastructure they already have — an API gateway, a load balancer, a
service mesh — and the rules carry over. The same routes, for a gateway:

| Routing file | Gateway |
|---|---|
| `api: communication-transcripts`, `to: https://api.example.gov/communication` | Send the transcripts API's paths to the transcripts service |
| `domain: '*'`, `except: [{ api: communication-transcription-sessions }]` | Everything to the state's services, but the sessions API, which the page answers |
| `api: …-adapter`, `match: { provider: aws-transcribe }`, `to: https://…` | A rule on the request body, or a small service in front that reads `provider` and forwards |

## Code that answers

`handler` is code that answers a route. In a file, it's the path of a
JavaScript module that exports a handler for each operation it answers, by
operationId; in code, a function, or such a module itself. A module needn't
answer every operation of the API it's routed for: a module for a session
adapter's streaming part can leave `requestCredentials` to an entry that sends
it to the state's server. The CLI imports the module; the
explorer's build bundles it, with whatever it imports, since a page opened
from disk can't import a module.

A handler gets the request and `{ params, publish, call }`. `call` makes
another call by operationId, through routing, so it reaches whatever answers
that operation in this deployment. `publish` sends an event the contracts
declare, as a call to `publishEvent`, so it goes wherever routing sends
publishing ([where the event bus runs](../inter-domain-communication.md#where-the-event-bus-runs)).
A [running adapter](adapters.md#a-running-adapter) reports with it.

## Several implementations, chosen per request

Some APIs have more than one implementation in a deployment: one session
adapter per transcription service, with the session's profile deciding which
a session uses. Each gets an entry with a `match`, written as a stub's match
is: dot paths into the request body, each with the value it must equal. The
first entry whose match the request meets answers it. `startStream` carries
`provider`, so `match: { provider: whisper }` picks Whisper's implementation.

A later request about the same resource may not carry the field: `stopStream`
names only the session. It goes to the entry that answered the earlier request
naming the same resource, by a path parameter with the name and value of a
field of that request — `transcriptionSessionId`. Without that, every site with
two vendors would write the same bookkeeping, and get it wrong in the same
place.

A match is equality only. If routing ever needs more, such as one of several
values, it would be an expression in CEL, as every expression in the blueprint
is, not a richer match.

## Single operations

Routing a whole domain or API keeps its data in one place. Routing one
operation of an API elsewhere splits it: a record the routed operation creates
is missing from the reads the rest of the API answers. So a single operation is
routed only when that can't happen: something outside the contracts answers it
anyway, as an adapter's operations are; several implementations answer it,
chosen by match; or it keeps no data of its own, as a credentials request or a
ruleset evaluation doesn't. Validation warns about a single operation routed
apart from the rest of its API.

## Prior art

- **Dapr components:** YAML files that pick which implementation backs a
  building block in each environment, so "you can swap out one component with
  the same interface for another" without changing the application. Routing
  files do the same for an API.
- **WireMock mappings:** JSON files that stub some requests and proxy the rest
  to a real service with `proxyBaseUrl` — "a proxy/intercept setup", the
  closest match to mocking some of an API set and sending the rest to real
  services.
- **Google Cloud's `x-google-backend` and AWS API Gateway's
  `x-amazon-apigateway-integration`:** OpenAPI extensions that bind an
  operation to what answers it — a URL, a function, a mock — per operation.
  They're written into a deployment's own copy of the API document; routing
  keeps the binding in a file of its own, so the contracts stay the same in
  every deployment.
- **Mock Service Worker:** request handlers in the page, with `passthrough()`
  to "perform it as-is" against the real network — the shape of a routed
  handler beside the mock.
- **Content-Based Router** (*Enterprise Integration Patterns*): "route each
  message to the correct recipient based on message content" — what a `match`
  does.
