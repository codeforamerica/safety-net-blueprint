# Reference index

Everything under `docs/` here is copied from the blueprint repository at the release in [SOURCE.md](SOURCE.md). Read a file when a step names it or when the work touches its subject. Don't read them all up front.

Many examples in the convention and architecture docs come from the safety-net contracts: applications, caseworkers, SNAP. Those are examples of the rule, and the rules apply to any domain.

## Conventions: how to write contracts

Instructions to follow. Read before writing the part each one covers.

| File | Covers |
|---|---|
| [standards.yaml](docs/conventions/standards.yaml) | Which standard to use for each mechanism; read before adding anything |
| [architecture-docs.yaml](docs/conventions/architecture-docs.yaml) | The spec's sections, decision records and writing rules |
| [contract-files.yaml](docs/conventions/contract-files.yaml) | How contract files make up a domain and sit side by side |
| [naming.yaml](docs/conventions/naming.yaml) | Casing and naming for types, fields, paths, events |
| [resources.yaml](docs/conventions/resources.yaml) | REST resource patterns: required info, fields, lists, pagination |
| [http.yaml](docs/conventions/http.yaml) | Errors, status codes, headers |
| [rpc.yaml](docs/conventions/rpc.yaml) | RPC endpoints and state machines |
| [events.yaml](docs/conventions/events.yaml) | Domain events and their envelope |
| [security.yaml](docs/conventions/security.yaml) | Authentication, roles, scopes, field permissions |
| [extensions.yaml](docs/conventions/extensions.yaml) | The `x-` extensions, such as data classification |
| [api-classification.yaml](docs/conventions/api-classification.yaml) | Classifying APIs by domain, type and status |
| [validation.yaml](docs/conventions/validation.yaml) | What validation checks |
| [diagrams.yaml](docs/conventions/diagrams.yaml) | Diagram colors, for any diagram in the spec |

## Patterns: which one to use, and how

One file per pattern, each in the same shape: what it is, when to use it, when not to and what to use instead, and its rules. Read the one that fits before recommending or writing that part.

| File | Covers |
|---|---|
| [adapter.yaml](docs/conventions/patterns/adapter.yaml) | Connecting to an outside system |
| [analysis.yaml](docs/conventions/patterns/analysis.yaml) | Analyzing documents and transcripts with a model |
| [audit-trail.yaml](docs/conventions/patterns/audit-trail.yaml) | Recording who did what, and when |
| [browser-vendor-stream.yaml](docs/conventions/patterns/browser-vendor-stream.yaml) | A live stream between the browser and a vendor, such as audio |
| [composition.yaml](docs/conventions/patterns/composition.yaml) | One view of several records |
| [context-passthrough.yaml](docs/conventions/patterns/context-passthrough.yaml) | Matching a result that comes back later to what asked for it |
| [cross-domain-communication.yaml](docs/conventions/patterns/cross-domain-communication.yaml) | Talking to other domains: commands and events |
| [overlay-customization.yaml](docs/conventions/patterns/overlay-customization.yaml) | Letting others adapt the contracts |
| [routing.yaml](docs/conventions/patterns/routing.yaml) | Sending a domain's calls to a real service instead of the mock |
| [timers.yaml](docs/conventions/patterns/timers.yaml) | Deadlines and reminders |

## Architecture: why the contracts work the way they do

| File | Covers |
|---|---|
| [architecture-philosophy.md](docs/architecture/architecture-philosophy.md) | Why the blueprint is built this way, in plain language |
| [architecture-patterns.md](docs/architecture/architecture-patterns.md) | The named software patterns behind it |
| [contract-driven-architecture.md](docs/architecture/contract-driven-architecture.md) | REST vs. RPC, behavioral contracts, adapters |
| [api-architecture.md](docs/architecture/api-architecture.md) | How the APIs are organized and operated |
| [inter-domain-communication.md](docs/architecture/inter-domain-communication.md) | Commands vs. events between domains |
| [rules-contracts.md](docs/architecture/rules-contracts.md) | Rules as a dependency graph, partial evaluation |
| [x-extensions.md](docs/architecture/x-extensions.md) | Every `x-` extension, alphabetically |
| [resolve-pipeline.md](docs/architecture/resolve-pipeline.md) | How overlays and resolve produce the output |
| [contracts-pipeline.md](docs/architecture/contracts-pipeline.md) | Resolve and validation as a build pipeline |
| [cross-cutting/behavioral-contract-dsl.md](docs/architecture/cross-cutting/behavioral-contract-dsl.md) | The state machine and procedure language |
| [cross-cutting/adapters.md](docs/architecture/cross-cutting/adapters.md) | Connecting to an outside system |
| [cross-cutting/identity-access.md](docs/architecture/cross-cutting/identity-access.md) | Authentication and authorization |
| [cross-cutting/contract-metadata.md](docs/architecture/cross-cutting/contract-metadata.md) | Annotations and field metadata |
| [cross-cutting/resource-composition.md](docs/architecture/cross-cutting/resource-composition.md) | Composite views across resources |
| [cross-cutting/timers.md](docs/architecture/cross-cutting/timers.md) | Deadlines and time-based callbacks |
| [cross-cutting/search.md](docs/architecture/cross-cutting/search.md) | Search across resources |
| [cross-cutting/platform.md](docs/architecture/cross-cutting/platform.md) | Platform-level resources |
| [cross-cutting/ai-services.md](docs/architecture/cross-cutting/ai-services.md) | Services that use a model |
| [cross-cutting/browser-vendor-stream.md](docs/architecture/cross-cutting/browser-vendor-stream.md) | A live stream between the browser and a vendor |
| [domains/communication-transcripts.md](docs/architecture/domains/communication-transcripts.md) | The framework's transcripts domain: recording and transcribing a conversation |

## Guides: how to do it

| File | Covers |
|---|---|
| [getting-started/new-domain-builders.md](docs/getting-started/new-domain-builders.md) | Building a domain on the framework, start to finish |
| [guides/creating-apis.md](docs/guides/creating-apis.md) | Writing REST APIs that follow the patterns |
| [guides/rules-guide.md](docs/guides/rules-guide.md) | Writing rulesets |
| [guides/overlay-guide.md](docs/guides/overlay-guide.md) | Overlay syntax and targeting |
| [guides/validation.md](docs/guides/validation.md) | Running validation |
| [guides/api-clients.md](docs/guides/api-clients.md) | The generated TypeScript client |
| [guides/mock-server.md](docs/guides/mock-server.md) | Seed data, events, stubs, the mock in a page |
| [guides/testing.md](docs/guides/testing.md) | Testing levels |
| [guides/search-patterns.md](docs/guides/search-patterns.md) | The `q` search parameter |
| [guides/ci-cd-backend.md](docs/guides/ci-cd-backend.md) | Validation and contract testing in CI |
| [guides/package-publishing.md](docs/guides/package-publishing.md) | Publishing a client package |
| [guides/setup-guide.md](docs/guides/setup-guide.md) | Adopting the safety-net contracts, when chosen |

## Domain research: how benefits agencies do the work

The safety-net domain docs. Read them to learn the field (see [field-knowledge.md](../field-knowledge.md)); they don't set the developer's contracts. Several are marked partial or not started.

| File | Covers |
|---|---|
| [domain-design.md](docs/architecture/domains/domain-design.md) | Every domain, what it owns, and how far along its design is. Start here |
| [data-exchange.md](docs/architecture/domains/data-exchange.md) | Outside agencies and data sources, and the rules on using them |
| [intake.md](docs/architecture/domains/intake.md) | Applications, as the applicant experiences them |
| [eligibility.md](docs/architecture/domains/eligibility.md) | Determining eligibility by program |
| [workflow.md](docs/architecture/domains/workflow.md) | Tasks, deadlines and verification work |
| [case-management.md](docs/architecture/domains/case-management.md) | Ongoing cases and staff assignments |
| [client-management.md](docs/architecture/domains/client-management.md) | People, their relationships, and matching records to a person |
| [communication.md](docs/architecture/domains/communication.md) | Notices, correspondence and transcribed conversations |
| [document-management.md](docs/architecture/domains/document-management.md) | Files and uploads |
| [scheduling.md](docs/architecture/domains/scheduling.md) | Appointments |
| [decision-support.md](docs/architecture/domains/decision-support.md) | Suggestions put in front of the person acting on a record |
