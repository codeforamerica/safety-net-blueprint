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
