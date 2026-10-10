# AI Services

> **Status: draft, and deliberately open.** This records the direction and what
> has been found so far, not settled requirements. Three goals shape it: define
> as much of the architecture as feasible as blueprint contracts, the way the
> rest of the blueprint is defined; avoid running a backend server where that
> can be done securely; and never trade security for avoiding one. Where each
> contract lives and what exactly it looks like are open — this names what
> should be a contract, not its final form.

## Overview

An AI service is a component that uses a model — speech, language, or vision —
to do work the blueprint describes: supporting a worker through an interview,
reading a document, drafting a notice. It does not replace any domain.

Integrating one creates new interfaces: how a person signs in to use it, what
the blueprint calls, what the service is allowed to do, what it records. The
blueprint's approach is that interfaces and behavior are declared in
reviewable, overlayable contracts, and every implementation satisfies them. So
those new interfaces are declared as contracts too, the way the eligibility
adapter is, and an implementation backed by Amazon Transcribe, Bedrock or
ElevenLabs satisfies them the way a vendor system satisfies an adapter
contract. What is left outside the contracts is deployment: IAM, keys, and the
choice of provider.

The design goals are that adding an AI service requires no change to any
domain, and that a state which overlays the contracts customizes its AI
services with them, with nothing else to edit.

## Three roles

An AI service plays one of three roles, and the role decides which contracts
it touches.

| | An assistant | An agent | A capability |
|---|---|---|---|
| **Example** | Listens to a worker's interview with an applicant; suggests answers, flags what to probe, screens for expedited service | Conducts the interview itself, speaking with the applicant | Classifies an uploaded document; extracts its fields |
| **Who calls whom** | The service calls the blueprint | The service calls the blueprint | The blueprint calls the service |
| **A person decides** | The worker, on every suggestion | Nobody in the moment; review comes after | The state machine step that called it |
| **Model** | Transcription plus a text model | Speech-to-speech | Text or vision |

**An assistant is the case furthest along.** The interview is a person's, and
the service proposes rather than acts: nothing is written until the worker
accepts. Live transcription for exactly this — a worker on a softphone call,
the applicant on another channel — already exists in
[safety-net-live-transcription-tools](https://github.com/codeforamerica/safety-net-live-transcription-tools),
and an assistant is built on its finished transcript lines.

## The contracts

Each entry says what the contract declares, a candidate shape, and its status:
**exists**, **to define**, or **open** where whether it should be a contract at
all is undecided. Where each lives is a candidate, not a decision.

### Where they live

The work splits by layer, not by feature:

| Layer | What goes there |
|---|---|
| **The framework** — `blueprint-core` and `blueprint-mock-server` | The general mechanisms, which know nothing about benefits: the Transcript and Suggestion resources, request and response templates and their schema, the toolsets contract type, the extension saying whether a model may use an operation, and the mock acting as the Data Exchange adapter. Any contract set built on the blueprint gets them — the case for a framework platform domain, which Transcript and Suggestion would be the first resources of. |
| **`safety-net-contracts`** | The interview assistant, the first use of those mechanisms: the interview's conduct and its transcript, the SNAP interview requirements, the risk ruleset, the eligibility ruleset the guidance evaluates, and the `fact_extraction` service and its catalog entry. This is program policy, and belongs with the real domain contracts. |
| **The application** | What speaks a provider's protocol — the transcription client — and the page code that captures audio. Neither is a contract, and neither belongs in the framework, which stays vendor-neutral. |
| **The harness** | Fictional fixtures that test the framework mechanisms in isolation, as it already exercises forwarding and stubs. Not policy. |

### Already in the contracts

From `safety-net-contracts`, an AI service uses:

| What it needs | Declared as | Status |
|---|---|---|
| The operations it may perform | OpenAPI paths, and state machine operations for eligibility, intake, platform and workflow | Exists |
| What it reads and writes | Request and response schemas, usable directly as a model's structured output | Exists |
| Why each field is asked, and the regulation behind it | `reason` and `policy` annotations — so far for intake and client management | Exists, partly |
| The interview as a record | The `Interview` schema in `intake-openapi.yaml` | Exists |
| External calls, and a catalog of them | Data Exchange's service catalog and service call lifecycle | Exists |
| What changed elsewhere | Domain events in AsyncAPI, on `GET /platform/events/stream` | Exists |
| Rulesets — guidance, screening, risk | None yet. The harness has fictional sketches — `interviewPrompts` and `expeditedSnap` — that show the idea, not real policy | To define |

Rulesets run in a page through `blueprint-rules-engine`, so once they exist an
assistant gets the result the eligibility domain would compute with no network
call.

Writes go through state machine operations, not raw updates, so guards, actor
roles and the audit trail apply to data a model captured exactly as they do to a
caseworker's.

### Authentication contracts

| Contract | What it declares | Candidate shape | Status |
|---|---|---|---|
| Sign-in | That callers sign in with OpenID Connect, using the authorization-code flow with PKCE, and which scopes they ask for | An `openIdConnect` or `oauth2` security scheme in the OpenAPI documents, with the issuer supplied per environment through an overlay or `${VAR}`; the rules in `docs/conventions/security.yaml` | To define |
| Who may use AI services | The permission to open a provider session, and which roles hold it | A permission in the [identity-access](identity-access.md) model | To define |
| AI actors | That an assistant acts *for* a person and an agent acts as itself, so events record which | An actor type in the identity-access model, alongside [event actor provenance](identity-access.md#event-actor-provenance) | To define |

AWS request signing (SigV4) is not part of these. It is how one deployment
proves identity to AWS, not something the contract requires, and it is not a
standard OpenAPI scheme.

### Interview guidance: three kinds, three sources

What an assistant puts in front of a worker during an interview is three
different things, with three different sources. Treating them as one ruleset —
as the harness's `interviewPrompts` sketch does — mixes them.

| Kind | Example | Source | Contract |
|---|---|---|---|
| **Missing information** the determination needs | "Ask about shelter costs" | Partial evaluation of the eligibility ruleset: it reports exactly which inputs are missing and would change the outcome, and nothing else | The eligibility ruleset itself. No separate ruleset — the questions fall out of the determination's own rules, explained by their `reason` and `policy` annotations. *No determination ruleset exists in the real contracts yet.* |
| **Risk indicators** — the error-prone situations behind payment error rates | "Income does not cover reported expenses" | Deterministic conditions over declared facts, plus what a model notices that a condition cannot — vague or contradictory answers | A ruleset of its own, separate from the determination. Each output is one indicator; its annotations carry the severity, the reason, the citation and the question to probe with. Most of the harness sketch's facts are of this kind. *To define.* |
| **Interview requirements** that must be said or asked regardless | Rights and responsibilities, penalty warnings, consent | Some apply always, some on a condition — the ABAWD notice only when a member is of ABAWD age | Split three ways: a ruleset decides which requirements apply; a registry type, `interview-requirements`, holds each one's wording, whether it must be read word for word, whether an attestation is recorded, and its policies; and the `Interview` records which are covered. The interview cannot complete until every applicable one is. *To define.* |

**Flat rulesets are still rulesets.** The determination is a deep dependency
graph, and the risk and applicability rulesets are one level deep — a list of
named conditions. Both are declared the same way and get the same things: typed
inputs bound to the data model, so a condition never names a field; partial
evaluation, so a condition whose inputs are unknown is *unknown* rather than
false, and those inputs become things to ask; examples; and one call that
evaluates every condition at once, in the page. A condition written against
fields directly — in a registry, say — would tie it to one state's data model.

Rulesets cannot yet declare that one takes another's outputs as inputs. Where
risk indicators should reuse the determination's computed totals rather than
recompute them, the chaining happens in the `Interview`'s state machine, which
evaluates the determination first and passes its outputs on. That works with
the DSL today; the dependency is visible there rather than in the rules
contract.

**The determination here is guidance, not the official one.** Nothing in an
interview records an eligibility Decision; that stays with the eligibility
domain and the caseworker. The risk is guidance drifting from policy, so the
guidance should evaluate the *same* eligibility ruleset the official process
uses, never a copy of it.

### The eligibility ruleset

The missing-information kind of guidance needs a SNAP eligibility ruleset,
which `safety-net-contracts` does not have. It is the largest piece of this
plan, and nothing earlier depends on it.

**One ruleset, two outputs: whether a household is eligible, and its monthly
allotment.** Net income drives both the net income test and the allotment —
the maximum allotment for the household size, less 30% of net income — so as
one dependency graph the shared facts are computed once and cannot disagree,
and partial evaluation reports what is missing for both answers at once. The
risk ruleset stays separate.

**What federal policy defines**, mostly in 7 CFR § 273.9 and § 273.10: the
gross and net income tests and the asset limit; the deductions that turn gross
income into net — standard, earned income, dependent care, medical for elderly
or disabled members, child support, excess shelter; the allotment, with its
minimum and first-month proration; who counts in the household; and work
requirements, including ABAWD time limits (7 CFR § 273.7, § 273.24).

**Everything carries an effective date.** Thresholds, allotments, deductions
and caps change every fiscal year on October 1, and Alaska and Hawaii have
their own tables, so amounts are parameters, declared as data with the date
each value takes effect — never written into an expression. The rules change
too: ABAWD work requirements were changed by the Fiscal Responsibility Act of
2023 and again by Public Law 119-21 in 2025. So a determination is evaluated
*as of* a date, and both parameters and rules need effective dating. None of
the contracts has it today — the rules, config and registry schemas carry only
a document `version` for change tracking — so it is an addition to the
contracts, and the first step toward this ruleset. Releases of the contracts are versioned
separately, as packages already are.

**The federal baseline, with state options declared.** Broad-based categorical
eligibility, which most states use, changes or removes the gross income and
asset tests; standard utility allowances are set by each state; reporting rules
vary. Each is a declared, named parameter in the baseline, and each state sets
its own values in its own overlay — the blueprint does not write them. A
Colorado demo needs Colorado's values from someone, labeled as such.

**Checking it.** A ruleset drafted from the regulations is not trusted until it
is checked, and review by someone who knows SNAP policy is what makes it usable:

- **Worked examples** in `*-rules-examples.yaml`, drawn where possible from FNS's
  own published calculations.
- **A cross-check against an independent implementation**, as the rules engine
  was checked against IRS FactGraph. PolicyEngine's open-source US model,
  `policyengine-us`, covers SNAP — with effective-dated parameters, state
  values such as each state's utility allowances, and ABAWD rules including the
  2023 and 2025 changes. It is AGPL-3.0: running it as an independent check is
  fine; copying its code or parameter files into the blueprint would carry the
  license's obligations, so amounts come from FNS directly.

Guidance or not, wrong rules would produce the payment errors this is meant to
reduce.

### AI calls, as Data Exchange services

A call to a model to do a job — extract facts from a transcript, classify a
document, draft a notice — has the shape of a Data Exchange call: a configured
service, a call with a lifecycle, a result announced as an event. Data
Exchange already has the pieces:

- the `ExternalService` catalog, `data-exchange-config.yaml`, keyed by
  `serviceType`, overlaid by states with their endpoints;
- the `ExternalServiceCall` resource and its lifecycle, synchronous or
  asynchronous;
- per-service-type input and result schemas — the call's `data` is already
  polymorphic on `serviceType`;
- results announced as `data_exchange.call.completed`.

So an AI call is a new **service type**, with its own input and result schemas,
and nothing else new:

| Service type | Input | Result | Status |
|---|---|---|---|
| `fact_extraction` | Transcript text, and the schema of what to fill in — the blueprint's own request schema for the target operation | Values matching that schema, each with a confidence and the quoted words it came from | To define |
| `document_classification` | A document | Its type, with a confidence | To define |
| `document_extraction` | A document and the schema to fill | Values matching it | To define |
| `notice_drafting` | The notice's facts and template | Draft text | To define |

**Who translates speech into the data model** is the `fact_extraction` call:
the blueprint supplies the target schema, the model fills it with only what was
said, and the blueprint validates the result. From "it's me, my two kids and my
mom" a model can propose four members and their relationships, but not names or
birth dates, because nobody said them — and partial evaluation then reports
those as missing.

### How a service call reaches a provider

The catalog entry for each AI service declares how to call its provider: a
**request template** and a **response template**, in the same shape a state
machine `call:` step already uses — a method, a path, and a body built from
`$`-references and CEL. Fact extraction through Bedrock, for example:

```yaml
# data-exchange-config.yaml — endpoint and model overlaid per environment
services:
  - id: fact-extraction-bedrock
    serviceType: fact_extraction
    endpoint:
      url: https://bedrock-runtime.us-east-1.amazonaws.com
      auth: aws-sigv4            # a name, never a credential
      authService: bedrock
    config:
      modelId: <model id>
      prompt: >
        Record only what the applicant or worker actually said. Leave out
        anything not stated. Quote the words each value came from.
    request:
      POST: /model/$config.modelId/converse
      body:
        system:
          - text: $config.prompt
        messages:
          - role: user
            content:
              - text: $input.transcript
        toolConfig:
          tools:
            - toolSpec:
                name: record
                inputSchema:
                  json: $input.resultSchema       # the blueprint's own schema
          toolChoice:
            tool: {name: record}                  # forces a schema-shaped answer
    response:
      result: $response.output.message.content[0].toolUse.input
```

Bedrock's Converse API lets a request require the model to answer by "calling"
a named tool, and the tool's input schema is whatever the request supplies —
so passing the blueprint's schema returns JSON already in the blueprint's shape.

What this declares:

- **The prompt is a contract**, reviewable and overlayable with the model
  choice, without touching code.
- **Changing provider is a new catalog entry.** The service type, its input and
  its result stay the same, so nothing that uses the result changes.
- **It is testable like a ruleset.** An entry can carry examples — a call's
  input and a recorded provider response, with the result expected — run
  against the mock with no live call.

Where a template cannot express a provider — a conversation that loops through
tool calls — what makes the call is open. A streaming protocol is not the
mock's to speak: see [What stays outside the mock](#what-stays-outside-the-mock).
Also open: building a
string from a list (`join`) is a CEL extension rather than core CEL, so the
evaluator would need it; and the rule for telling an expression from a fixed
value should be confirmed against how `call:` and `with:` are parsed before a
template schema is written.

### Transcripts

The written record of a conversation, on the framework's platform domain: its
states — recording, paused, closed — its lines and its gaps. A transcription
client in the page streams audio straight to the provider and reports finished
lines and gaps to the transcript; the blueprint holds the client to rules — it
refuses a line spoken while paused or after closing, closes a transcript the
client abandons, and judges each line by when it was spoken. Settings are a
config catalog entry. The audio stream and the provider's protocol stay outside
the blueprint. See [Transcripts](transcripts.md). *To define.*

### Provider session

How a page gets a short-lived session for a provider: `POST /sessions`
returning `{ provider, token, expiresAt }`, satisfied by the identity pool for
AWS and by the [token function](#the-token-function) for a provider outside
AWS. An adapter contract. *To define.*

### New resources

**Suggestion**, on platform. Anything an assistant, or a rule, puts in front of
a worker, and the worker's decision on it. Platform knows only two kinds:

- **Proposes an operation.** Carries the operation and its arguments, the
  evidence, the source and a confidence. Accepting it performs the operation,
  with the guards and audit trail of any other request. Recording a household
  member is one; so is marking a required item covered, which is just an
  operation on the interview.
- **Informs.** No operation; the worker acknowledges or dismisses it. A
  question to ask, a risk indicator.

Owning domains declare **categories**, each with its own payload schema —
eligibility declares "missing determination input" and "risk indicator",
intake "required item covered" — the same per-type-schema pattern Data Exchange
uses for service types. Platform owns the lifecycle — proposed, then accepted,
rejected, expired or superseded — and knows nothing about interviews. The
suggestion record is also the provenance: what was proposed, from which words,
by what, and who decided. *To define.*

The worker's acceptance is what vouches that a value is *true*; schema
validation only says it has the right shape. So a worker's screen must show
each suggestion's evidence beside it.

**Interview**, in intake, extended. `safety-net-contracts` already declares an
`Interview` in `intake-openapi.yaml` — the regulatory record that the interview
happened, linked to scheduling appointments, as `intake.md` describes. Its
conduct belongs on the same resource rather than a separate session: recording
consent, starting, the applicable interview requirements, and completing,
guarded on every applicable item being covered. It refers to its
[transcript](transcripts.md), whose recording its consent guards and its
completion closes. Its state machine also re-runs the guidance rulesets when the interview's application changes, and
creates the resulting suggestions. Recertification belongs to case management
under `eligibility.md`, which does not model it yet; a recertification interview
is the same `Interview` with a different parent, and where it lives is settled
when recertification is modeled. *To define.*

### Events

Declared in AsyncAPI, in whichever domain owns each resource: a transcript's
line added, gap recorded, paused, resumed and closed; `suggestion.proposed`,
`.accepted`, `.rejected` and `.expired`; `interview.started` and
`interview.completed`. *To define.*

**Whether an event is stored could be declared too.** Some events are wanted
only by whoever is displaying them at that moment — lines still firming up, a
"reconnecting" status — and storing them would cost memory for nothing. If one
of those ever travels on the bus, each event type would declare whether it is
persisted, replacing the mock's hard-coded rule that `scheduling.*` events are
broadcast but not stored. Nothing planned needs it yet: only finished lines
reach the blueprint.

### Tools

A model acts by calling tools, so the tools it is given decide what it can do.
Generating them from the contracts — rather than writing them per service —
means an overlay that renames a field, adds a requirement or removes an
operation reaches every AI service without anyone editing them.

| Contract | What it declares | Candidate shape | Status |
|---|---|---|---|
| Whether a model may use an operation at all | Per operation: available to a model or not | An `x-` extension on the operation, narrowed further by an overlay — so a state can keep a model away from, say, approving a determination | To define |
| Toolsets | Which operations, rulesets and resources a given assistant or agent gets — an interview assistant gets reading the application, evaluating the guidance rulesets, and proposing suggestions, and nothing else | A new authored contract type, `*-toolsets.yaml`, with a schema in `blueprint-core` like every other type, validated and overlayable | To define |
| How a tool is described to a model | The tool's name, its description, and the description of each argument | Derived: the operation's `summary` and `description`, and each field's `reason` and `policy` annotations. An override only where the derived text is not enough | To define |
| Tool definitions | The tools themselves, in the shape models accept | **Not a contract** — a generated artifact, from the contracts above, beside the existing artifact and Postman generators. Works on `contracts.json`, so it runs in a page | To build |

A tool call from an assistant does not perform the operation. It creates a
suggestion, and the worker's acceptance performs it — so an assistant's toolset
names operations it may *propose*, and an agent's names operations it may
perform.

### Outside the contracts

Deployment choices, not statements about what the system must do:

- IAM roles, the identity pool, the token function's code, and every API key.
- Which provider and model serve each part.
- Per-environment configuration — the same rule as the mock's
  [forwarding](../../guides/mock-server.md#forwarding-to-a-real-service): a
  contract set is shared, deployment choices are not.

Prompts are **not** in that list: a service's prompt is part of its catalog
entry — see [How a service call reaches a provider](#how-a-service-call-reaches-a-provider).

## How fast

"Real time" means three different things here, and they need different designs.

- **Transcription** streams continuously; lines appear as people speak and are
  replaced as they firm up.
- **An assistant's suggestions** follow finished *turns* — everything one
  person said before the other spoke. A few seconds is fine, since the worker is
  mid-conversation and glances at them. One model call per turn, rather than per
  line, keeps the number of calls and their cost down.
- **An agent's conversation loop** — speech in, model, speech out — has to
  answer in about a second, and stays inside the speech model's session.

None of the three needs the blueprint to be fast: a suggestion is an ordinary
request, and the event stream carries what changed.

## The mock as the integration point

In a demo running in a single page, the mock is not only the stand-in for the
blueprint's APIs. It is also the **adapter** for Data Exchange: when a service
call arrives for a service whose catalog entry has an endpoint, the mock makes
the call itself — evaluates the request template, signs the request, sends it,
evaluates the response template, validates the result against the service
type's result schema, completes the call, and emits `call.completed`. Nothing
about the provider is in page code; it is all in the catalog.

This is the outbound half of the mock's
[forwarding](../../guides/mock-server.md#forwarding-to-a-real-service).
Forwarding today sends requests that come *into* the mock to a real service;
this sends calls the mock *makes* to one. Built for AI services, it works for
every Data Exchange service — a state testing its real income-verification
adapter gets the same thing.

**Credentials are the signed-in person's.** The page hands the mock a function
that returns them, alongside its forwarding configuration: identity-pool
credentials for AWS, a provider session token for anything else. The mock signs
with whichever the catalog entry names. It attaches no credential of its own.

**One event bus — the mock's.** Transcript lines, turns, suggestions and every
domain event travel on the platform bus, and everything that reacts to them is
declared in a state machine.

### An interview, end to end

A worker interviews an applicant. The page holds the worker's UI, audio capture,
sign-in, and the mock.

1. **The worker starts the interview.** The page calls `record-consent`, then
   `start`, on the `Interview`. The interview requirements that apply to this household
   are attached.
2. **The applicant speaks.** The page's transcription client streams the audio
   to the provider, and adds each finished line to the interview's transcript;
   each arrives on the bus as an event.
3. **A turn finishes** — the applicant's lines are followed by the worker's. The
   `Interview` state machine reacts by creating a
   `fact_extraction` service call, with the turn's text and the schema of what
   it is filling in.
4. **The mock makes the call** to the model, from the catalog entry, and
   completes it. A declared step turns the result into suggestions — four
   household members, each proposing "add household member", with the words each
   came from.
5. **The worker accepts them.** Each performs its operation, with the guards and
   audit trail of any request.
6. **The application changed, so the interview re-runs its guidance.** Partial
   evaluation of the eligibility ruleset reports names and birth dates missing;
   the risk ruleset flags income below expenses. Each becomes a suggestion that
   informs.
7. **The worker reads the penalty warning.** The next extraction notices it and
   proposes marking that item covered; the worker accepts.
8. **The worker completes the interview.** `complete` succeeds only once every
   applicable required item is covered. Open suggestions expire, and
   `interview.completed` fires.

The worker's panel through all of this is the interview's open suggestions — its
list endpoint, kept current by events.

### What stays outside the mock

- **Audio capture**, because a browser grants the microphone and a shared window
  only to page code, on a click.
- **The audio stream to the provider**, in the transcription client.
- **Sign-in**, which produces the credentials the mock is given.

The audio stream stays out deliberately: providers design for the browser
connecting directly, and a mock that relayed audio would become a real
implementation of a provider integration.
The blueprint's part is the transcript: what the client reports, and the rules
it is held to. See [Transcripts](transcripts.md#why-the-audio-stream-stays-out-of-the-mock).

### On a server

For a channel with no browser — an agent on a phone line — the same contracts
apply, and a real implementation of them does what the mock does. The in-tab
mock is out of reach there, so it is tested against the Node mock.

## Security and performance

The mock is for demos with fictional data, not for real applicants. A real
deployment implements the same contracts; the mock is their reference
implementation. Within that, five things keep the design from doing harm.

**Outbound calls go only where the catalog says.** A request template may use a
call's input in the request body, never to choose the host. Otherwise whoever
creates a call could point the mock at any server, carrying whatever data the
template sends. Redirects are refused, as forwarding refuses them. A page's
content security policy limits it further, to the endpoints its `connect-src`
lists.

**CEL is safe to evaluate.** It cannot run arbitrary code, reach the network, or
loop without end, so evaluating a template from a contract or an overlay is not
executing code from it.

**What is said can try to steer the model.** An applicant could say something
meant as an instruction to it. For an assistant, that is contained: the model
only proposes, the worker decides, and every value is validated against the
schema. An agent acts on its own, so its toolset is the limit on what such an
instruction could make it do.

**Credentials stay narrow.** The mock signs with the signed-in person's
credentials, and for a demo those should be on the cost side of
[the line](#what-narrow-means) — models and transcription, never real data. A
Node mock doing the same would use a developer's own AWS profile, so it is for
local use, never a shared server.

**Events are cheap because partial lines never reach the mock.** Measured in
the mock, a stored event costs about 1.3 KB of memory, publishing one takes
0.04 ms, and listing the first 50 of 5,000 takes 34 ms, rising with the number
stored. A one-hour interview's finished lines are on the order of a thousand —
their events a megabyte or two — which a day of demos absorbs, and a reload
clears. Lines still firming up arrive several times a second; stored, they
would be twenty megabytes an hour and listing would slow with them. They stay
in the client.

## Hosting in a single page

The aim, as a goal rather than a requirement, is an application delivered as
one HTML file — the shape both the mock's `standalone.html` and the
transcription tools' `live-transcription.html` already take — that uses the
mock and AI services together, with no server of our own.

| Part | In a page? | Basis |
|---|---|---|
| UI, mock server, rules engine | Yes | Done in this repository: the mock and the rules engine both run in a tab, and the mock ships as one file. |
| The mock calling AI services from the catalog | To build | The outbound half of forwarding; a `fetch` from the page, signed with the person's credentials. |
| Signing in | Yes | Done in the transcription tools: a Cognito user pool's public app client with PKCE, through a popup. |
| Credentials for AWS services | Yes | Done in the transcription tools: a Cognito identity pool exchanges the worker's token for one-hour credentials whose IAM role allows a single action. Nothing in the page is a secret. |
| Streaming audio to AWS | Yes | Done in the transcription tools: the worker's microphone and the call's shared audio, streamed to Transcribe over a signed WebSocket from a page opened from disk. |
| Text and vision models on Bedrock | Very likely | An ordinary signed HTTPS request with the same credentials, and calling Bedrock from a page with identity-pool credentials is a published pattern. Not yet done here. |
| Speech-to-speech on Bedrock (Nova 2 Sonic) — agent only | **Unproven** | Uses a bidirectional HTTP/2 stream. One published account calls it directly from a browser; every AWS sample places something between — AgentCore Runtime, Lambda with AppSync Events, or a server. |

So an assistant on AWS is buildable from parts that are all proven but one,
and that one is a plain request. A provider outside AWS changes this — see
[ElevenLabs](#elevenlabs). An agent's live voice is the claim still to prove; if a
browser cannot hold the stream, AgentCore Runtime sits between the page and the
model for the voice session only, authorized by the same Cognito token. That is
a managed component rather than a server anyone operates.

**What "no server" still includes.** Sign-in needs one hosted page: an OAuth
redirect cannot return to a file opened from disk, so the transcription tools
serve a two-file callback page from a private S3 bucket behind CloudFront. It
is static. Whether the application itself is opened from disk or served is a
separate choice, with a security consequence — see
[Opening the page from disk](#opening-the-page-from-disk).

**Rules a host page follows**, carried over from the transcription tools:

- A content security policy whose `connect-src` allows only the Cognito,
  identity pool and AWS service endpoints — which also guarantees audio and
  transcripts go nowhere else.
- Transcripts and model output stay out of browser storage. Pages opened from
  disk share one `localStorage` in Chrome, readable by any other downloaded page.
- Text from a call or a model is rendered with `textContent`, never `innerHTML`.
- A headset, so the worker's microphone does not pick up the applicant's side.

**Browsers.** The transcription tools support Chrome and Edge only. They
capture at the 16 kHz Transcribe expects and refuse to start if the browser
runs audio at any other rate; AWS's own voice samples report the same limit,
saying Firefox and some other browsers will not capture at 16 kHz. Resampling
in the page would lift it, and is untested. Until then, a page that captures
audio is Chrome and Edge only — a real constraint for workers whose agencies
standardize on another browser.

**Cost.** With no backend, the IAM role is the only control on what a
signed-in person can call. The transcription tools pair it with an AWS Budgets
alert at 80% of a monthly limit. An alert notifies; it does not stop spending,
so anything public needs a hard limit as well.

## How sign-in becomes access

One sign-in serves everything. What differs is how that sign-in becomes
permission to use each provider, and there are two patterns: AWS services
trust the sign-in directly, and a provider outside AWS does not.

### Signing in

The same for every provider. A Cognito user pool, with an app client that has
no secret — a page cannot keep one — and PKCE protecting the exchange:

1. The page makes a random *verifier*, and opens Cognito's sign-in page in a
   popup, sending only a hash of it.
2. The worker signs in — a password, or the agency's own identity provider.
3. Cognito redirects the popup to the hosted callback page with a one-time
   *code*. The callback hands the code to the page and closes.
4. The page sends the code *and the verifier* to Cognito, which checks the
   verifier against the hash from step 1 and returns tokens: an ID token, an
   access token, and a refresh token. A code without the verifier is useless,
   which is what makes this safe without a secret.

The tokens prove who the worker is. They are not yet permission to use any AWS
service or any other provider.

### AWS services: the identity pool

AWS accepts the sign-in directly, through a Cognito identity pool:

5. The page gives the ID token to the identity pool, which returns AWS
   credentials — a key, a secret and a session token — valid for about an hour
   and limited to what the identity pool's IAM role allows.
6. The page signs each request with them (SigV4): a presigned WebSocket URL for
   Transcribe, a signed HTTPS request for Bedrock. AWS checks the signature and
   the role, and serves the request.
7. Before the hour is up, the refresh token gets a new ID token, and step 5
   runs again.

Nothing in this flow is ours to run. The identity pool is the token issuer,
operated by AWS.

### A provider outside AWS: a token function

A provider such as ElevenLabs authenticates with an API key that can never be
in a page, and it does not accept AWS credentials or Cognito tokens. It offers a
short-lived token instead, created by a call that carries the key. So a
function the page can reach holds the key:

5. As above: the page gets AWS credentials from the identity pool.
6. The page calls the [token function](#the-token-function), signing the
   request with those credentials. AWS refuses an unsigned request, or one from
   a role not allowed to invoke the function, before the function runs.
7. The function checks the person's limit, reads the provider's API key from
   Secrets Manager, asks the provider for a token, and returns it.
8. The page connects to the provider directly with the token — for an
   ElevenLabs agent, a signed URL valid for 15 minutes or a conversation token.
   Audio and conversation go straight between the page and the provider; the
   function sees neither.
9. The next session repeats steps 6 to 8.

Most voice and speech providers work this way — a long-lived key held by a
server, short-lived tokens handed to clients — so the same function serves
another provider with a different call in step 7.

### Blueprint APIs: the access token

The blueprint's own APIs take the worker's Cognito token as a bearer token, as
[Identity & Access](identity-access.md) describes; no exchange is involved. The
mock needs none, and identifies the caller from its `X-Caller-Id` and
`X-Caller-Roles` headers. A page that reaches real blueprint APIs is on the data
side of [the line drawn below](#what-narrow-means).

### Compared

| | AWS services | A provider outside AWS | Blueprint APIs |
|---|---|---|---|
| **What the page holds** | AWS credentials, about an hour | A provider token, minutes, one session | The Cognito access token |
| **Who issues it** | The identity pool (AWS) | The token function (ours) | Cognito |
| **What limits it** | The IAM role | The function's checks, and the provider's token scope | The permissions in the token |
| **Server-side code of ours** | None | The token function | The APIs themselves |

### One interface in the page

The two patterns differ only in where a session comes from, so the page need
not know which it is using. It asks for a session for a provider and gets back
credentials or a token with an expiry: from the identity pool for AWS, from the
token function for anything else. The mock and the rest of the page are the
same either way, and in development one switch points both at fake
sessions.

AWS stays on the identity pool rather than going through the token function.
Routing it through the function would mean the function minting AWS credentials
itself, which needs a broader role than the page has, to replace a service AWS
already runs.

### Per-person limits

IAM says *which* actions a person may call, not *how many times*. Once issued,
AWS credentials are usable freely until they expire, so on AWS the only limits
on cost are account-wide — service quotas and a spend cap. The token function
can limit how often one person gets a session from a provider outside AWS, but
it cannot limit what they do with AWS credentials.

Limiting each person's use of an AWS service needs every call to pass through
something that counts — a relay, which is a backend. If per-person limits on AWS
usage become a requirement, that is the point at which avoiding a server stops
being possible.

## Opening the page from disk

A single HTML file can be handed to someone and opened straight from disk —
`file://` — with nothing installed and nothing hosted but the sign-in callback.
The transcription tools work this way. It is convenient, and it is safe only
while the credentials it signs in for can do little harm.

### The weakness

A page opened from disk has no origin. The callback page that completes
sign-in therefore cannot address the sign-in code to one particular page; it
hands it to whichever page opened the sign-in window. The transcription tools'
`callback.js` records this as a known gap.

PKCE means a code is useless without the verifier held by the page that
started the sign-in, so a stolen code alone gets nothing. The weakness is
different: **any other HTML file the worker opens can start its own sign-in.**
It holds its own verifier, so its code works. If the worker's Cognito session is
still live, the sign-in completes without asking for a password, and that file
receives the same credentials the real page would. Asking for a password on
every sign-in protects the real page's sign-ins but does not stop another page
starting a silent one. A downloaded file that does this is not exotic: it is
an attachment or a lookalike of the real tool.

### What "narrow" means

Whatever the real page can do with its credentials, a hostile file opened on the
same machine can do too. So the question for `file://` is what those
credentials allow, and the answer is set in one place — the IAM role the
identity pool gives a signed-in person, and the permissions on any token the
page carries.

| What the credentials allow | Worst case for a hostile local file | From disk? |
|---|---|---|
| Open Transcribe streams *(the transcription tools today)* | Transcribes audio of its own at the account's expense. Reads nothing. | Acceptable for a prototype, with a spend limit |
| Call Bedrock models | Runs models at the account's expense. Reads nothing, unless the role also reaches stored data such as a knowledge base. | Acceptable with per-user limits and a spend cap |
| Get an ElevenLabs session token | Holds voice sessions on the account. Reads nothing. | Acceptable with per-user limits on the token function |
| Call blueprint APIs as the worker | Reads and changes applicant records with the worker's permissions. | **No** |
| Anything reaching stored data — S3, a database, transcripts | Reads it. | **No** |

**Narrow** means every action in that role fails safe: its worst case is cost,
bounded by quotas and a spend cap, and none of it reads or changes data. That is
the line. A page opened from disk may hold credentials on the cost side of it,
and none on the data side.

A page that calls real blueprint APIs is on the data side, so a real deployment
— real applicants, real records — is served, not opened from disk. The mock in
the tab is not on the data side: it holds fictional data and no credential
reaches it, so a page using only the mock and AWS models can still be opened
from disk.

### Serving it instead

Serving the same file from a fixed HTTPS origin closes the weakness: the
callback sends the sign-in code only to that origin, and Cognito's list of
allowed callback URLs names it. It is still one static file and still no
server.

What matters is that the origin is the application's alone:

- **S3 behind CloudFront** — the transcription tools' callback already lives
  there, and the application can sit beside it on the same distribution.
- **GitHub Pages with a custom domain** — its own origin, so equally good.
  Pages cannot set response headers, but the content security policy can be a
  `<meta>` tag, which supports `connect-src`.
- **GitHub Pages at `codeforamerica.github.io`** — *not* the application's
  alone. Every project site there shares that one origin, since an origin is
  scheme and host and ignores the path. Any other Code for America Pages site
  could start a sign-in, and they all share browser storage. It narrows the
  weakness from "any file on the machine" to "any of the organization's sites",
  but does not close it.

## ElevenLabs

ElevenLabs offers three things relevant here, each an alternative or a
complement to an AWS service:

| ElevenLabs | What it does | Closest AWS equivalent |
|---|---|---|
| Agents | A hosted voice agent: speech in, a language model, speech out, with tools | Nova 2 Sonic, or AgentCore Runtime around it |
| Scribe v2 Realtime | Streaming speech-to-text, with interim and committed results | Transcribe streaming |
| Text to speech | Generated speech from text, streamed | Polly |

**Agents call tools in the page.** The browser SDK supports *client tools* —
functions the agent calls that run in the page and return a result to it —
alongside tools the agent calls on a server. A client tool can be a request
to the mock, so the tool definitions generated from the contracts serve an
ElevenLabs agent as they would a Bedrock model, and each call meets the same
guards. Voice
conversations run over WebRTC, text over WebSocket.

**Signing in is the difference that matters.** An ElevenLabs API key must never
be in a page, and a page cannot exchange a Cognito token for ElevenLabs
credentials the way it does for AWS. ElevenLabs' answer is a short-lived token
the page connects with — a signed URL valid for 15 minutes or a conversation
token for an agent, a single-use token for Scribe — and each is created by a
call that carries the API key. So something trusted has to hold the key.

The options, from most to least preferred:

- **A small token function on AWS.** A Lambda that returns an ElevenLabs
  token, with the API key in Secrets Manager. It relays no audio and keeps no
  state; the page still talks to ElevenLabs directly. It is a server-side
  component, but a few dozen lines with no data in it, and it is the only option
  that is both secure and supported. See [The token function](#the-token-function).
- **A public agent with an origin allowlist.** The page connects with only the
  agent's ID, and ElevenLabs accepts connections from listed hostnames. An
  origin check is not access control: it stops other websites, not anyone
  calling the agent directly, and anyone who can open the page can spend the
  account's minutes. Fit for a demo with fictional data, not for real
  applicants.
- **An API key in the page.** Not an option.

So adopting ElevenLabs means one small server-side function where AWS alone
needs none. That is a reasonable trade if its voices or agents are better for
the job; it should be a deliberate one.

### The token function

The page already holds identity-pool credentials, so the function needs no
authentication code of its own:

- **A Lambda function URL with IAM authentication.** The page signs its request
  with SigV4, as the transcription tools already sign their Transcribe
  connection, and the identity pool's role gains one permission — to invoke
  this function. An unsigned call is refused before the function runs.
- **The function** reads the ElevenLabs key from Secrets Manager, makes one
  call to ElevenLabs, and returns the token.
- **Per-person limits.** Every call carries a signed-in identity, so the
  function can limit how many tokens one person gets in a period. That is the
  main control on cost: without it, a signed-in person could start sessions
  without bound.

The token is on the cost side of [the line above](#what-narrow-means), so a
page opened from disk may call it.

**Its interface can be a blueprint contract; its implementation cannot.** An
endpoint that issues a short-lived session token for a provider outside AWS,
returning something like `{ provider, token, expiresAt }`, can be declared like
any other. Declared that way, the mock serves it with a fake token, so a page is
built and tested against the mock with nothing deployed. The Lambda, its IAM
policy and the secret are AWS deployment, and belong with the infrastructure of
whatever deploys the application, since the blueprint stays vendor-neutral.

The leaning is an adapter contract rather than a general identity-access
endpoint. The page reaches AWS through the identity pool, never through this
endpoint, so in practice it serves only providers outside AWS — and an adapter
contract is the blueprint's existing shape for exactly that.

**Data handling.** For applicant data, what matters is retention and where data
is processed. Reported by third parties and to confirm in the partnership: a
HIPAA business associate agreement and a Zero Retention Mode at the enterprise
tier, where zero retention is requested per call rather than set once, and US,
EU or India data residency. SNAP data is not health data, but the same terms are
what protect it.

## Testing

A service is built and tested against the mock, which serves every domain —
and every contract above, once defined — from the contract set. The provider
session endpoint, declared as a contract, is served by the mock with a fake
token, so a page runs end to end with nothing deployed. When a real backend
exists for one domain, the mock's
[forwarding](../../guides/mock-server.md#forwarding-to-a-real-service) sends
that domain to it and keeps the rest mocked.

A transcript does not have to come from a live call. Added to the mock through
the transcript's operations, a recorded or written one replays an interview,
and becomes a fixture like any other.

Rulesets carry their own examples, and a service's catalog entry can carry its
own — an input and a recorded provider response, with the result expected — so
both the guidance and the extraction are checked with no live call.

## Compliance

An AI service handles the same data as any other channel, and the same
obligations apply — see [Identity & Access](identity-access.md#regulatory-requirements).
Two arise only here: consent to record or transcribe a conversation, and, for
an agent, disclosure that the person is speaking with an automated system.

Both are contracts. Consent is recorded on the interview and guards starting
and resuming its transcript; whether it is required is overlayable, since states differ on
whether every party to a recording must agree. Disclosure is a step an agent's
session must complete before its first question. Declared that way, they are
reviewed once and enforced everywhere, rather than trusted to each service.

## Likely first steps

None of this is decided. Each is something to try as soon as it exists, since
the mock serves a contract the moment it is declared.

1. **The transcript**, on a platform domain the framework now provides: its
   states, lines and gaps, the rules a client is held to, its settings, and a
   recorded transcript replayed with no live call. Then an application's client
   streaming to Transcribe from a page and writing to it — the first proof that
   a page with no backend reaches an AI service securely and the blueprint
   follows the conversation.
2. **The suggestion resource**, on the same domain: its two kinds, its lifecycle
   and its events. Usable at once — create, accept and reject suggestions
   against the mock — with no model and no AWS.
3. **The interview's conduct and its requirements**, in
   `safety-net-contracts`: consent, start, its transcript, the
   `interview-requirements` registry, the ruleset deciding which apply, and
   complete guarded on them. Useful alone, and it can start before any ruleset
   exists: requirements that always apply need no condition.
4. **The mock calling services from the catalog** — templates, signing and the
   adapter role, in the framework — **and the `fact_extraction` service** in
   `safety-net-contracts`, reading the transcript. The first working assistant
   end to end.
5. **The risk ruleset**, in `safety-net-contracts`, with severity and probes in
   its annotations.
6. **The operation extension and toolsets**, then the generator for tool
   definitions.
7. **The sign-in security scheme and the provider session contract.**

Larger and later:

- **The SNAP eligibility ruleset** — see [The eligibility ruleset](#the-eligibility-ruleset).
  First the effective dating it needs in the rules contract, then the federal
  baseline with its parameters and state options, then examples and the
  cross-check, then review by SNAP policy staff.
- Transcribing a recording after the fact, as a Data Exchange service.
- For an agent, live speech-to-speech from a page.

## Open questions

- Where the recertification interview lives, which waits on case management
  modeling recertification.
- Where the transcription client lives: with the application that uses it, or
  beside the transcription tools it is built from.
- How long a recording transcript may go without activity before it closes
  itself.
- What makes a call a template cannot express, such as one that loops through
  tool calls.
- How a template tells an expression from a fixed value — to match `call:` and
  `with:` once confirmed.
- Whether the provider session is an adapter contract or a general
  identity-access endpoint — the latter worth it only if something other than a
  page needed provider tokens.
- Whether per-person limits on AWS usage are needed. If they are, a relay is
  needed too — see [Per-person limits](#per-person-limits).
- Which provider handles which part — transcription, the language model, and
  for an agent the voice — and whether a better voice is worth one server-side
  function.
- How effective dating is expressed — per value, as `policyengine-us` does, or
  per version of a document — and whether rules and parameters share one
  mechanism.
- Who supplies Colorado's values for a Colorado demo.
- Whether transcripts are ever kept. The transcription tools keep them out of
  storage, so a suggestion's evidence is the quoted words, not a reference to a
  stored transcript. Keeping them is a policy decision, not a technical one.
