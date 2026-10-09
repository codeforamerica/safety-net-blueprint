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

### Already in the contracts

An AI service uses much of the contract set as it stands:

| What it needs | Declared as | Status |
|---|---|---|
| The operations it may perform | OpenAPI paths and state machine operations | Exists |
| What it reads and writes | Request and response schemas, usable directly as the model's structured output | Exists |
| Why each field is asked, and the regulation behind it | `reason` and `policy` annotations | Exists |
| What to probe for in an interview | `interviewPrompts` in `intake-rules.yaml` — household facts in, the FNS-1104 topics a worker must probe out, served at `POST /intake/applications/evaluate-interview-prompts` | Exists |
| Screening partway through | `expeditedSnap` in `eligibility-rules.yaml` | Exists |
| How to check the rules | `*-rules-examples.yaml` — worked inputs and expected outputs | Exists |
| What changed elsewhere | Domain events, on `GET /platform/events/stream` | Exists |

Rulesets run in the page through `blueprint-rules-engine`, so an assistant gets
the result the eligibility domain would compute with no network call. The
result is advisory; the determination is still made by eligibility.

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

### Services the blueprint or a page calls

Adapter contracts, in the shape of the eligibility adapter: the blueprint
declares the interface, an implementation satisfies it.

| Contract | What it declares | Candidate shape | Status |
|---|---|---|---|
| Provider session | How a page gets a short-lived session for a provider | `POST /sessions` returning `{ provider, token, expiresAt }`. Satisfied by the identity pool for AWS and by the [token function](#the-token-function) for a provider outside AWS | To define |
| Transcription | Starting and stopping a transcription session, and the shape of a transcript line whatever produced it | A provider-neutral segment schema — the transcription tools' `{ id, role, isPartial, start, end, text, words, speakers }` is the starting point — with Transcribe and Scribe output mapped to it | To define |
| Fact extraction | Turning a stretch of transcript into the facts a ruleset or an operation takes | Input: transcript segments and the target schema. Output: values matching that schema, each with a confidence | To define |
| Document extraction and classification | What document-management sends and gets back | An adapter called from a document state machine step | To define |
| Notice drafting | What communication sends and gets back | An adapter called from a communication state machine step | To define |

### New resources

Resources with lifecycles, declared in OpenAPI and a state machine, so their
rules are reviewable and overlayable like any other.

**Suggestion.** What an assistant proposes: an operation to perform and its
arguments, with the model's confidence and the transcript lines it drew on.
Its lifecycle runs proposed → accepted, rejected or expired, and accepting it
performs the operation it names. That makes "the model proposes, the worker
decides" a declared rule with guards and an audit trail, rather than something
each service implements. It also answers provenance: the suggestion record is
the record of what the model proposed, who accepted it, and from what. A
suggestion can name an operation in any domain, so its home is open — platform,
beside events, is a candidate. *To define.*

**Interview session.** Starts, runs and completes; tied to an application and
its transcript. Consent becomes a guard: a session cannot start transcription
until consent is recorded. That puts a compliance rule in a contract rather
than in each service's code. Intake, whose domain covers interview
requirements, is a candidate home. *To define.*

### Events

Declared in AsyncAPI, in whichever domain owns each resource:
`transcript.segment.finalized`, `suggestion.proposed`, `suggestion.accepted`,
`suggestion.rejected`, `interview.started`, `interview.completed`. *To define.*

### Tools

A model acts by calling tools, so the tools it is given decide what it can do.
Generating them from the contracts — rather than writing them per service —
means an overlay that renames a field, adds a requirement or removes an
operation reaches every AI service without anyone editing them.

| Contract | What it declares | Candidate shape | Status |
|---|---|---|---|
| Whether a model may use an operation at all | Per operation: available to a model or not | An `x-` extension on the operation, narrowed further by an overlay — so a state can keep a model away from, say, approving a determination | To define |
| Toolsets | Which operations, rulesets and resources a given assistant or agent gets — an interview assistant gets reading the application, evaluating `interviewPrompts`, and proposing suggestions, and nothing else | A new authored contract type, `*-toolsets.yaml`, with a schema in `blueprint-core` like every other type, validated and overlayable | To define |
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

Prompts are **open**. They decide how a model behaves, and a state might want to
review them as it reviews a notice template — an argument for declaring them.
They are also tied to a particular model, which argues against.

## How fast

"Real time" means three different things here, and they need different designs.

- **Transcription** streams continuously; partial lines appear as people speak
  and are replaced as they firm up. It runs directly between the page and AWS.
- **An assistant's suggestions** follow finished lines. A few seconds is fine —
  the worker is mid-conversation and glances at them — so a suggestion is one
  text-model request per finished line or group of lines, not a streaming
  session.
- **An agent's conversation loop** — speech in, model, speech out — has to
  answer in about a second. It stays entirely inside the speech model's
  session. A synchronous call to a system of record on every turn would spend
  that budget.

None of the three needs the blueprint to be fast: tool calls are ordinary API
requests made when the model decides to act, and the event stream carries what
changed.

## Where a service runs

The same tool layer runs in either place, so a service can move between them.

**In the page**, for an application a person uses in a browser. Transcription
and the model run from the page, tool calls are executed in the page, and in
development they reach the mock running in the same tab:

```
 One HTML file
 ┌──────────────────────────────────────────────────────────────────┐
 │  Worker's UI ◄── suggestions ── Assistant ◄── finished lines ──┐ │
 │      │ accepts                     │  ▲                         │ │
 │      ▼                             │  │ tool definitions        │ │
 │  Tool layer ──► blueprint API      │  │ (from the contracts)    │ │
 │      │          (mock in this tab, │  │                         │ │
 │      │           or real)          ▼  │                         │ │
 │      └────────► rules engine      text model ◄─┐   Transcription │ │
 └─────────────────────────────────────────────────┼────────▲───────┘ │
                                                    │        │ mic + call audio
                         short-lived AWS credentials │        │
             Cognito ──────────────────────────────►─┴────────┘
                                     Amazon Bedrock      Amazon Transcribe
```

**On a server**, for a channel with no browser — an agent on a phone line. It
runs server-side and calls the blueprint API over HTTP, authenticating as a
service (see [Identity & Access](identity-access.md#service-to-service-authentication)).
The in-tab mock is out of reach there, so it is tested against the Node mock.

## Hosting in a single page

The aim, as a goal rather than a requirement, is an application delivered as
one HTML file — the shape both the mock's `standalone.html` and the
transcription tools' `live-transcription.html` already take — that uses the
mock and AI services together, with no server of our own.

| Part | In a page? | Basis |
|---|---|---|
| UI, mock server, rules engine, tool layer | Yes | Done in this repository: the mock and the rules engine both run in a tab, and the mock ships as one file. |
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
token function for anything else. The tool layer and the rest of the page are
the same either way, and in development one switch points both at fake
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
alongside tools the agent calls on a server. That is the same shape as the
page-side tool layer above, so the blueprint's tool definitions and tool layer
would serve an ElevenLabs agent as they would a Bedrock model. Voice
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

A transcript does not have to come from a live call: the transcription tools'
`Transcript` accepts segments from any source, so an assistant is tested by
replaying a recorded or written transcript. With the segment schema defined,
recorded transcripts become fixtures like any other.

Rulesets carry their own examples, so whether an assistant's extracted facts
produce the right probes is checked against `*-rules-examples.yaml`.

## Compliance

An AI service handles the same data as any other channel, and the same
obligations apply — see [Identity & Access](identity-access.md#regulatory-requirements).
Two arise only here: consent to record or transcribe a conversation, and, for
an agent, disclosure that the person is speaking with an automated system.

Both can be contracts. Consent is a guard on the interview session, so a
transcript cannot start without it. Disclosure is a step an agent's session
must complete before its first question. Declared that way, they are reviewed
once and enforced everywhere, rather than trusted to each service.

## Likely first steps

None of this is decided.

1. **A text-model request from the page**, with the transcription tools'
   sign-in and credentials, proving the one unproven part an assistant needs. A
   small page; not shipped.
2. **The transcript segment schema and the fact-extraction adapter contract**,
   since an assistant's first job — transcript to facts to `interviewPrompts` —
   depends on both.
3. **The suggestion resource and its state machine**, so an assistant has
   somewhere to put what it proposes, and provenance comes with it.
4. **The operation extension and toolsets**, then the generator that turns
   them into tool definitions.
5. **The sign-in security scheme and the provider session adapter contract**,
   which every service needs before any of it reaches real data.

Only for an agent: **prove live speech-to-speech from a page**, or choose what
sits in front of it — AgentCore Runtime on AWS, or an ElevenLabs agent with a
token function.

## Open questions

- Where each new contract lives — the suggestion resource especially, since it
  can name an operation in any domain.
- Whether the tool layer — the code that turns a model's tool call into a
  blueprint call — belongs in the blueprint or in each service.
- Whether prompts are contracts.
- Whether the provider session is an adapter contract or a general
  identity-access endpoint — the latter worth it only if something other than a
  page needed provider tokens.
- Whether per-person limits on AWS usage are needed. If they are, a relay is
  needed too — see [Per-person limits](#per-person-limits).
- Which provider handles which part — transcription, the language model, and
  for an agent the voice — and whether a better voice is worth one server-side
  function.
- How the transcription tools and the blueprint's page are combined into one
  file. Both are built to be inlined, but the tools register classic scripts on
  a global while the mock's bundle is a module for its served build and a
  global for its standalone one.
