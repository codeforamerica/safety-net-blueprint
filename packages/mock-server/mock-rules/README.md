# Mock Simulation Rules

Rule sets in this directory simulate external system behavior (adapters) during
local development and integration testing. They use the same schema as production
rules (`packages/contracts/schemas/rules-schema.yaml`) but are loaded exclusively
by the mock server — never deployed to production.

## Purpose

In production, external adapters subscribe to domain events and call real services
(SSA, FDSH, USCIS SAVE, etc.), then emit result events. Mock simulation rules
replace that adapter behavior by subscribing to the same trigger events and
immediately firing the equivalent result events with plausible fixture data.

Example flow with mock rules active:
1. Intake rules create a `data-exchange/service-calls` record
   → mock server emits `data_exchange.service_call.created`
2. A mock rule fires on `data_exchange.service_call.created`
   → fires `data_exchange.call.completed` with fixture result data
3. Intake rules react to `data_exchange.call.completed` as normal

## Conventions

- **File naming:** `{domain}-mock-rules.yaml` (e.g., `data-exchange-mock-rules.yaml`)
- **Rule set IDs:** Must be prefixed with `mock.` (e.g., `mock.simulate-call-completion`)
  to prevent ID collision with production rule sets if both are loaded together
- **Event types:** Use the same CloudEvents type names that real adapters would emit —
  downstream subscribers must not know or care whether the event came from a real
  adapter or a mock rule
- **CloudEvents naming:** All event type segments use snake_case (underscores).
  `on: data_exchange.call.completed`, not `on: data-exchange.call.completed`

## Loading

The mock server calls `discoverRules()` twice at startup: once for
`packages/contracts/` (production rules) and once for this directory (mock rules).
Both are merged and registered as event subscriptions. Production rules are never
aware of the mock rules alongside them.

## Mock stub registry

Stubs let you pre-program specific outcomes before triggering a flow. Register a
stub before creating the service call; when the `service_call.created` event fires,
the stub is consumed and its result event fires instead of the default fallback.

The response event is built from the contract: the `x-events` payload schema for
the response type drives field population. Fields with matching names are copied
from the trigger event's data; `serviceCallId` is derived from the trigger's
`subject`. Only specify what changes:

```bash
# Pre-program an inconclusive result for fdsh_ssa calls
curl -s -X POST http://localhost:1080/mock/stubs \
  -H "Content-Type: application/json" \
  -d '{
    "on": "data_exchange.service_call.created",
    "match": { "data.serviceType": "fdsh_ssa" },
    "respond": {
      "type": "data_exchange.call.completed",
      "data": { "result": "inconclusive" }
    }
  }'
```

The `match` field is optional — omit it to match any service call regardless of type.

When multiple stubs match the same event, they are consumed in registration order (FIFO). Register stubs in the order you expect events to arrive.

## HTTP stubs

HTTP stubs intercept outbound HTTP calls made by event handlers — for example, calls to the eligibility rules engine adapter. Register an HTTP stub before triggering the flow that will make the call; when the handler calls the matching URL, the stub response is returned instead of reaching the real endpoint.

```bash
# Pre-program a response for the eligibility adapter's expedited screening endpoint
curl -s -X POST http://localhost:1080/mock/stubs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "http",
    "match": {
      "method": "POST",
      "url": "/evaluate/expedited-screening"
    },
    "response": {
      "body": { "expedited": true }
    }
  }'
```

The `match.method` field is optional — omit it to match any HTTP method. The `response.status` field defaults to `200`.

HTTP stubs appear alongside event stubs in `GET /mock/stubs` and are removed by the same `DELETE /mock/stubs` and `DELETE /mock/stubs/:id` endpoints. Like event stubs, HTTP stubs are consumed (removed) on first match and follow FIFO ordering.

If no stub is registered when a handler makes an outbound HTTP call, the call returns a `501 Not Implemented` error. This is intentional — the mock server does not make real outbound calls. Register a stub before triggering any flow that makes an adapter call.
