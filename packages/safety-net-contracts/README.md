# @codeforamerica/blueprint-safety-net-contracts

> OpenAPI specs, state machines, event schemas, and overlays for safety net benefits programs — reference implementation of the Blueprint framework

[![npm version](https://img.shields.io/npm/v/@codeforamerica/blueprint-safety-net-contracts.svg)](https://www.npmjs.com/package/@codeforamerica/blueprint-safety-net-contracts)
[![license](https://img.shields.io/npm/l/@codeforamerica/blueprint-safety-net-contracts.svg)](https://github.com/codeforamerica/safety-net-blueprint/blob/main/LICENSE)

> **Pre-release:** This package is at `0.x`. Until `1.0.0`, minor versions may include breaking changes. Pin your version if stability matters.

## What It Is

A reference implementation of the Blueprint framework for safety net benefits programs. It defines the full API surface — data operations (REST), behavioral operations (RPC), events, and field metadata — as contract artifacts that states can adopt, customize with overlays, and build adapters against.

States don't fork this package. They install it, apply overlays to customize contracts for their context (renaming fields, restricting visibility, setting domain-specific defaults), and point the Blueprint CLI at the resolved output.

## Installation

```bash
npm install @codeforamerica/blueprint-safety-net-contracts
```

## What's Included

Contract artifacts are organized under `src/` by domain:

| Domain | Contracts |
|--------|-----------|
| **Intake** | Application submission, household composition, document upload, program selection |
| **Eligibility** | Eligibility determination, program rules, decision records |
| **Case Management** | Case lifecycle, task assignment, SLA tracking, worker queues |
| **Client Management** | Person records, household relationships, contact information |
| **Document Management** | Document upload, classification, retention |
| **Workflow** | Cross-domain task routing, approval queues, escalation |
| **Data Exchange** | Inter-agency data sharing, federal reporting adapters |
| **Scheduling** | Appointment booking, interview scheduling, timer events |
| **Communication** | Notices, correspondence, notification preferences |
| **Platform** | Events bus, policy registry, system configuration |
| **Identity & Access** | User accounts, roles, permissions |

Each domain includes:
- **OpenAPI spec** (`*-openapi.yaml`) — REST and RPC endpoints with full schema definitions
- **State machine** (`*-state-machine.yaml`) — lifecycle states, transitions, guards, and actor restrictions
- **AsyncAPI catalog** (`*-asyncapi.yaml`) — events emitted and subscriptions consumed
- **Annotations** (`*-annotations.yaml`) — field-level policy citations and data classifications

## Adopting the Blueprint

Install the package alongside the CLI and resolve the base contracts with your state-specific overlays:

```bash
npm install @codeforamerica/blueprint-safety-net-contracts @codeforamerica/blueprint-cli

# Resolve base contracts with your overlays
npx blueprint-resolve \
  --spec ./node_modules/@codeforamerica/blueprint-safety-net-contracts/src \
  --overlay ./overlays/config.yaml \
  --out ./resolved

# Validate resolved output
npx blueprint-validate --resolved ./resolved

# Start the mock server for frontend development
npx blueprint-mock --spec=./resolved
```

See the [Setup Guide](https://github.com/codeforamerica/safety-net-blueprint/blob/main/docs/guides/setup-guide.md) for the full walkthrough and the [Overlay Guide](https://github.com/codeforamerica/safety-net-blueprint/blob/main/docs/guides/overlay-guide.md) for overlay authoring.

## Changelog

See [CHANGELOG.md](https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/safety-net-contracts/CHANGELOG.md) for release history.

## Documentation

See the [Safety Net Blueprint documentation](https://github.com/codeforamerica/safety-net-blueprint) for full guides and reference.

## License

[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)
