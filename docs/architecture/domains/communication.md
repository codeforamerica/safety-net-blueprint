# Communication Domain

> **Status:** Transcripts are built: the transcript, its lifecycle, its
> timeline, the profiles it is started under, and closing an abandoned one, in
> the framework's `communication` domain
> (`blueprint-core/base-contracts/domains/communication/`). Notices have minimal
> contracts, for document request notices; their full lifecycle is TBD.

See [Domain Design Overview](domain-design.md) for context, [AI Services](../cross-cutting/ai-services.md)
for how transcripts fit with suggestions and fact extraction, and [Contract-Driven Architecture](../contract-driven-architecture.md) for the
contract approach.

## Overview

The Communication domain covers what passes between the agency and the people
it serves: the notices sent to clients, and the written record of conversations
with them.

Notices — approvals, denials, requests for information, document requests, and
other official correspondence — can originate from any domain; Communication
reacts to domain events and handles delivery. A contract set declares its
notices itself.

A transcript is the written record of one conversation: who said what, and
when, including the stretches that were off the record and the stretches that
were lost. It is not tied to audio — a chat or a text-message exchange produces
one too — and everything that comes after it, from fact extraction to the lines
a suggestion cites as evidence, needs only the record, not how it was
captured. In the safety net contracts, the first use is an assistant following
an eligibility interview, working from its transcript. The blueprint
holds the record and the rules for keeping it; turning speech into text is done
by a transcription service the staff member's transcription software talks to directly.
Transcripts are provided by the framework, and a contract set includes them by
listing the `transcripts` capability ([Decision 1](#decision-1-a-framework-domain-of-its-own)),
without taking anything else the framework adds to the domain.

## What happens during a transcribed conversation

1. A staff member starts a transcript for the conversation — an interview, say —
   under a profile: the transcription service and languages the state chose for
   that kind of conversation. The software begins sending the audio to that
   service.
2. As each sentence is finished, the software adds it to the transcript, with
   when it was said and who said it.
3. If the other person asks to go off the record, the staff member pauses the
   transcript. Nothing said while paused is kept. When they resume, recording
   continues.
4. If transcription drops out — a lost connection, a service failure — the
   software records the stretch that was lost once transcription works again.
5. Anyone following along, such as the staff member's own screen, sees each
   change as it happens.
6. When the conversation ends, the staff member closes the transcript. Nothing more is
   added after that.

## Entity model

### Notice

An official communication sent to a client (full schema TBD).

### Transcript

The record of one conversation.

- **What it records** — the conversation it belongs to, such as an interview,
  and what kind of thing that is. A transcript is reused across conversation
  types — in a benefits program, interviews, calls on an existing case, fair
  hearings — so it names its
  subject rather than belonging to one.
- **What produced it** — the profile it was started under, which names the
  transcription service; the software that wrote it; and the service's model.
  Two transcripts made a month apart by the same service can differ because
  the service changed its model, and anyone judging a transcript's accuracy
  needs to know which produced it. A typed conversation is started under a
  profile with no service.
- **When it started and closed** — by the software's clock, the same clock
  every time on its entries uses, so every comparison is between times from one
  clock.
- **When it was last heard from** — when its last line or gap ended, by the
  software's clock. A transcript closed for being idle closes at that time.
- **Status** — recording, paused or closed. See the lifecycle below.

A transcript is refused when its profile does not exist, or when the profile
names a service and the transcript does not say which model.

### Profile

A state's choice of how to transcribe a kind of conversation.

- **The transcription service**, or none, for a chat or typed notes.
- **The languages** the conversation may be in. One fixes the language; several
  let the service tell which is being spoken, for an interview that moves
  between them. With none, the service detects the language itself, which not
  every service can do.

A deployment's configuration seeds the profiles. After that, they are added and
changed through the API, and never deleted, so every transcript's profile still
exists. Each change is recorded with what it changed from, so what a profile said
when any transcript started can be looked up. Settings that depend on the
software's own equipment — the audio format, which channel carries which
speaker — are the software's to choose, not the profile's.

### Entry

One period of the conversation, in a timeline under the transcript. Every entry
has a start and an end, so one ordering and one set of rules cover every kind.

- **Kind** — a line, a gap or a pause. The three mean different things to
  someone relying on the record: a line is something said or typed; a gap is a
  stretch lost by accident, where the record is incomplete; a pause is a
  stretch off the record by choice, where nothing is missing.
- **Started and ended** — when the period began and ended. A pause still going
  on has no end yet.
- **Text** (lines) — what was said or typed.
- **Speaker** (lines) — who said it, as a role. The contract set names its roles,
  so a benefits program can say worker and applicant.
- **The service's speaker label** (lines) — with one microphone in a room, a
  transcription service labels speakers "speaker 0" and "speaker 1", and
  something has to map those to people. Keeping the service's own label lets a
  wrong mapping be corrected later.
- **Confidence** (spoken lines) — how sure the service was, for anyone weighing a
  line as evidence.
- **Language** (lines) — the language the line was transcribed in, as the service
  reported it. People move between languages within a conversation, so each line
  says its own rather than the speaker or the transcript; anything that
  translates a line, or cites one, needs to know.
- **Cause** (gaps) — why nothing was captured, as far as the software knows:
  the connection, the service, the software, or unknown. It shows how
  reliable a transcript is.

## Transcript lifecycle

| State | Description | SLA clock |
|---|---|---|
| Recording | The conversation is on the record; lines are accepted. | none |
| Paused | The conversation is off the record, usually because the other person asked. Nothing said now is kept. | none |
| Closed | The conversation has ended. Terminal. | none |

A transcript starts recording. Pausing moves it to paused and begins a pause in
its timeline; resuming returns it to recording and ends that pause. Closing, from
either state, ends it — and ends a pause still open.

What a transcript accepts follows from the lifecycle:

| The software | The transcript |
|---|---|
| Adds a line said while recording | Keeps it — even if it arrives after a pause began |
| Adds a line said while paused, or after closing | Refuses it |
| Adds a line that ends before it starts | Refuses it |
| Records a lost stretch that overlaps a pause | Refuses it: the pause already accounts for that time |
| Sends the same line again on a retry | Keeps one |
| Sends lines out of order | Lists them in the order they were said |
| Changes an entry once written | Refuses it. Only the lifecycle ends a pause |
| Never closes — the browser closed, the machine crashed | Closes it, when its profile sets an idle timeout, between one and two of those after the software was last heard from — at the time it was last heard from |

A refusal names the rule that did not hold.

## Domain events

| Event | Why it's needed | Trigger | Primary consumers |
|---|---|---|---|
| `communication.transcript.created` | A conversation began being recorded | Starting a transcript | The staff member's screen; anything that will read the transcript |
| `communication.transcript.paused` | The conversation went off the record | Pausing | The staff member's screen; audit |
| `communication.transcript.resumed` | It is back on the record | Resuming | The staff member's screen; audit |
| `communication.transcript.closed` | The record is complete, so work that needs the whole conversation can begin | Closing | Fact extraction and suggestions |
| `communication.transcript_entry.created` | A line, a lost stretch or a pause was added | Adding an entry, or pausing | The staff member's screen; anything reading the conversation live |
| `communication.transcript_entry.updated` | A pause ended | Resuming, or closing while paused | The staff member's screen |
| `communication.transcript.updated` / `.deleted` | What a transcript records was corrected, or it was removed | Updating or deleting it | Audit |
| `communication.transcription_profile.created` | A profile was added through the API | Adding a profile | Audit |
| `communication.transcription_profile.updated` | A profile changed; records each change with what it changed from | Changing a profile | Audit; anyone asking what a transcript was started under |

### How notices are triggered

Communication sends notices by subscribing to domain events rather than receiving direct API calls. The producing domain emits an event when its own state changes; Communication reacts independently. No calling domain has a compile-time or runtime dependency on the Communication API contract.

This is consistent with the decision rule in [`docs/architecture/inter-domain-communication.md`](../inter-domain-communication.md): use a command only when the caller needs a result to continue its operation. Sending a notice is a fire-and-observe side effect, not a blocking dependency.

#### Inbound: `intake.verification.created` (document-type)

Communication subscribes to this event filtered by `verificationType === 'document'`. When a document-type Verification is created — either at application submission (e.g., residency) or as a fallback after an inconclusive electronic check — Communication sends a document request notice to the applicant.

#### Outbound: `communication.notice.sent`

Emitted after a notice is sent.

| Field | Type | Notes |
|-------|------|-------|
| `noticeId` | uuid | The notice record ID |
| `type` | enum | Template identifier — see `NoticeSentEvent` schema |
| `sentAt` | date-time | When the notice was sent |
| `metadata` | object | Domain-keyed correlation context (opaque) |

`metadata.intake.verificationId` carries the Intake Verification ID so Intake can correlate the notice back without a separate lookup.

**Intake reaction:** Intake subscribes to `communication.notice.sent` and appends `{ noticeId, type, sentAt }` to the relevant Verification's `documentRequests[]`.

## Contract artifacts

### Transcripts

All in `blueprint-core/base-contracts/domains/communication/`.

| Artifact | File |
|---|---|
| API — transcripts, their entries, and profiles | `communication-transcripts-openapi.yaml` |
| Lifecycle and the rules for entries | `communication-transcripts-state-machine.yaml` |
| Events | Generated by resolve beside the API, as `communication-transcripts-events-asyncapi.yaml`, from the API and the state machine's `emits:` |
| Transcription services | `communication-registry-transcription-services.yaml` |
| Profiles a deployment starts with | `communication-config.yaml`, validated by `communication-config-schema.yaml` |
| Sample transcripts | `communication-mock-data.yaml` |

### Notices

In the safety net contract set, `safety-net-contracts/src/domains/communication/`.

| Artifact | Status | Notes |
|----------|--------|-------|
| OpenAPI spec | Alpha | `communication-openapi.yaml` — shell spec. No REST paths yet. `communication.notice.sent` is a placeholder in `communication-asyncapi.yaml` until the notice resource and its state machine exist. |
| Event schemas | Defined | `communication-asyncapi.yaml` — `NoticeSentEvent` |
| State machine YAML | TBD | Notice lifecycle |
| Rules YAML | TBD | Routing rules, retry policies |
| Metrics YAML | TBD | Delivery success rates, time-to-send |

## Key design decisions

| # | Decision | Summary |
|---|---|---|
| 1 | [A framework domain of its own](#decision-1-a-framework-domain-of-its-own) | Transcription is a capability the framework provides and a contract set opts into |
| 2 | [Live transcription is not a data exchange call](#decision-2-live-transcription-is-not-a-data-exchange-call) | Its own resource; recordings transcribed after the fact can still use data exchange |
| 3 | [Audio never passes through the blueprint](#decision-3-audio-never-passes-through-the-blueprint) | The software streams audio to the service; the blueprint receives finished lines |
| 4 | [One timeline of entries](#decision-4-one-timeline-of-entries) | Lines, lost stretches and pauses in one ordered list |
| 5 | [An entry is judged by when it started](#decision-5-an-entry-is-judged-by-when-it-started) | Not by when it arrives |
| 6 | [One clock: the software's](#decision-6-one-clock-the-softwares) | Every time on a transcript comes from the software |
| 7 | [Entries do not change](#decision-7-entries-do-not-change) | Only the lifecycle ends a pause |
| 8 | [A retry is recognized by a key](#decision-8-a-retry-is-recognized-by-a-key) | The software sends the same key when it retries |
| 9 | [A dropped connection is a gap, not an event](#decision-9-a-dropped-connection-is-a-gap-not-an-event) | The record shows what was lost, whatever caused it |
| 10 | [A transcript names its profile; the profile's history is the record](#decision-10-a-transcript-names-its-profile-the-profiles-history-is-the-record) | Profiles change through the API, and their change events say what each said when |
| 11 | [Event-driven triggers — not RPC](#decision-11-event-driven-triggers--not-rpc) | Notices are sent in reaction to other domains' events |

### Decision 1: A framework domain of its own

**Status:** Decided: C

**What's being decided:** A transcript has nothing specific to one program or
one kind of conversation in it, so where it is defined decides who can use it.

**Considerations:**
- In a benefits program, interviews, calls on an existing case and fair
  hearings all produce conversations worth a record, across domains and across
  contract sets.
- Platform holds infrastructure every domain plugs into — the event log,
  registries. A transcript is a capability some domains use, with its own
  records, lifecycle and rules, the way scheduling and document management are.
- A contract set that never transcribes anything should carry none of it.
- A transcript is the record of a conversation, one kind of communication;
  notices and messages are others. A set that has a `communication` domain of
  its own adds to the framework's rather than conflicting with it, since
  documents of one domain combine.

**Options:**
- **(A)** In the domain of its first use — intake, in the safety net contracts. Another domain could not use it, and
  since intake belongs to one contract set, neither could another set.
- **(B)** In the framework's platform domain. Every contract set would get it,
  needed or not.
- **(C) ✓** In a `communication` domain the framework provides, as the
  `transcripts` capability a contract set includes by listing it. See
  [Platform](../cross-cutting/platform.md#decision-3-the-platform-is-infrastructure-only)
  for why a set opts into a capability rather than a whole domain.

### Decision 2: Live transcription is not a data exchange call

**Status:** Decided: B

**What's being decided:** Data exchange already models calls to outside
services, so whether a live transcript is one of those calls decides whether it
gets a resource and lifecycle of its own.

**Considerations:**
- A data exchange call is a request and one answer: the blueprint submits it,
  an adapter performs it, one result comes back.
- A live transcript is started by a staff member, written by their transcription software,
  and grows line by line for an hour, with pauses and lost stretches the call
  lifecycle has no place for.
- Transcribing a recording after the fact — an uploaded call or hearing — is a
  request and one answer.

**Options:**
- **(A)** A data exchange call left open for the whole conversation, with a
  lifecycle unlike any other service type's.
- **(B) ✓** A resource of its own. A recording transcribed after the fact can
  still be a data exchange call whose result fills a transcript, so live and
  after-the-fact transcription end in the same record by two routes.

### Decision 3: Audio never passes through the blueprint

**Status:** Decided: B

**What's being decided:** Turning speech into text happens at a transcription
service, so whether the audio travels through the blueprint on its way there
decides what the blueprint has to understand.

**Considerations:**
- Services design for the browser connecting directly: Amazon Transcribe
  documents streaming from a browser with temporary credentials, and ElevenLabs
  issues single-use tokens so a browser can connect to its service.
- Relaying audio adds delay and cost, and would put each service's own protocol
  inside a vendor-neutral system.
- What the people relying on the record need is the record, not the audio.

**Options:**
- **(A)** The software sends audio to the blueprint, which relays it to the
  service and writes the lines itself.
- **(B) ✓** The software streams audio straight to the service and adds each
  finished line to the transcript. A state that wants audio kept off staff
  machines runs a service that implements the transcript contract and
  transcribes on its side.

**Decision:** Only finished lines reach the blueprint. Lines still being
revised arrive several times a second, and the staff member's own screen gets them
from the software directly.

### Decision 4: One timeline of entries

**Status:** Decided: B

**What's being decided:** A transcript holds lines, stretches that were lost and
stretches that were off the record, so how they are stored decides how anyone
reads the whole conversation.

**Considerations:**
- A reader — a staff member, a reviewer, fact extraction — needs the conversation in
  order, including where it was off the record or lost.
- Caption formats and contact-center transcripts carry non-speech segments,
  such as silence, inline with the speech.
- Which stretches were off the record has to be checked when a line arrives.

**Options:**
- **(A)** Separate lists of lines, lost stretches and pauses, which every reader
  merges by time.
- **(B) ✓** One timeline, each entry a period with its kind. A pause is written
  when the transcript pauses and given its end when it resumes, so the timeline
  shows it while it is happening and is the one record of past pauses.

### Decision 5: An entry is judged by when it started

**Status:** Decided: B

**What's being decided:** A service finishes a line a second or two after it is
said, so a line said just before a pause can arrive just after it, and what the
rule judges decides whether that line is kept.

**Considerations:**
- The software is already trusted for when every line was said.
- A line can begin on the record and run past the moment the staff member paused.
- The point of pausing is that nothing said off the record is kept, even by
  faulty software.

**Options:**
- **(A)** By when it arrives. Simpler, but drops real speech from any
  software that does not send its pending lines before pausing.
- **(B) ✓** By when it started: kept if it started while recording. A few words
  said just after the pause may be kept with the sentence they finish.
- **(C)** By its whole period: refused if any part overlaps a pause. Nothing said
  after the pause is kept, but neither is the sentence it ended.

### Decision 6: One clock: the software's

**Status:** Decided: B

**What's being decided:** Lines carry the software's times while the server
has a clock of its own, so which clock marks the start, pauses and close decides
whether a rule ever compares two clocks.

**Considerations:**
- Two computers' clocks differ by seconds. A rule comparing a line's time with a
  pause the server timed would keep or drop lines by that difference.
- Software that misreports when it paused could equally misreport when a
  line was said, so trusting it for both adds no new trust.

**Options:**
- **(A)** The server times the start, pauses and close; the software times
  lines. Two clocks, compared.
- **(B) ✓** The software times everything. The server keeps its own record of
  when it received things, for auditing.
- **(C)** Judge by when things arrive, with a few seconds' grace after a pause.
  One clock, but faulty software gets a few seconds of off-the-record
  speech kept.

### Decision 7: Entries do not change

**Status:** Decided: B

**What's being decided:** Whether an entry is accepted depends on the pauses
already in the timeline, so whether entries can be edited decides whether the
record can be rewritten after the fact.

**Considerations:**
- Editing a past pause would change which lines should have been kept.
- A pause has to be given its end when the transcript resumes.

**Options:**
- **(A)** Entries editable by whoever can add them.
- **(B) ✓** Nothing about an entry changes but a pause's end, written only by
  resuming or closing. The rule allowing it names the system as the only actor.
- **(C)** A pause written once, complete, on resume. No edits at all, but the
  timeline would not show a pause while it is happening.

**Known gap:** a contract set that renames its roles must keep one for the
system, or validation refuses the transcript's lifecycle.

### Decision 8: A retry is recognized by a key

**Status:** Decided: B

**What's being decided:** Software whose connection drops before it hears
back sends a line again, so how a repeat is recognized decides whether the
transcript gets the line twice.

**Considerations:**
- Payment and cloud APIs recognize retries by a key the client sends with each
  request, the same on every retry; an internet standard for it is in draft.
- Every other record in the blueprint gets its identifier from the server.
- Two people can start speaking at the same instant, so a line's start time
  does not identify it.

**Options:**
- **(A)** The software chooses each entry's identifier.
- **(B) ✓** The software sends a key with each line it adds, and the same key
  on a retry; a repeat gets the first answer back.
- **(C)** A line's start time and speaker together.

### Decision 9: A dropped connection is a gap, not an event

**Status:** Decided: B

**What's being decided:** Whether a dropped connection loses anything depends on
the software — one that buffers audio and sends the backlog loses nothing —
so what the record notes decides what a reader can rely on.

**Considerations:**
- What matters to anyone relying on the transcript is whether it is complete.
- The software learns where a lost stretch ends only once transcription works
  again.

**Options:**
- **(A)** Record each connection change.
- **(B) ✓** Record the outcome: a lost stretch, with both times, once
  transcription comes back or the transcript closes, whatever caused it. A
  "reconnecting" notice on the staff member's screen comes from the software.

### Decision 10: A transcript names its profile; the profile's history is the record

**Status:** Decided: D

**What's being decided:** A transcript has to say what produced it for as long
as it is kept, while the profiles it is started under change — a state moves a
profile to another service, or adds a language.

**Considerations:**
- An old transcript pointing at a profile that has since changed must not appear
  to have been produced by the profile's current service.
- A configuration file changes by deploy, which records nothing a transcript
  can be tied to; a change made through the API is recorded, with what it
  changed from.
- Software should not have to send what the server already knows.

**Options:**
- **(A)** The software sends the service on every transcript, and profiles only
  guide it. Duplicated, and nothing records which profile a transcript ran under.
- **(B)** The server copies the profile's service onto each transcript. Survives
  any later change, but records one setting rather than the profile.
- **(C)** Versioned profiles, each version never changed. A complete record, but
  only while nobody edits a published version — which nothing could prevent —
  and every old version is kept forever.
- **(D) ✓** Profiles are managed through the API and never deleted. A
  transcript names only its profile; the profile's change events say what it
  said at any moment. Finding what a past transcript ran under is a lookup in
  those events — cheap for one transcript, though not a filter across many. If
  reporting by service is needed, the service can be copied onto transcripts
  then (B), without breaking anything.

### Decision 11: Event-driven triggers — not RPC

**Status:** Decided

**What's being decided:** Whether other domains trigger notices via direct API calls to Communication or via domain events.

**Decision:** Domain events. The calling domain has no dependency on Communication's API. Adding a new notice type requires no change to the producing domain — only a new subscription in Communication. This is consistent with the event-driven pattern in `docs/architecture/inter-domain-communication.md`.

## Key design questions

- **Notice lifecycle** — What states and transitions does a notice go through? Which transitions require supervisor approval?
- **Delivery channels** — How are multiple delivery methods (postal, email, portal) modeled? Per-notice or per-delivery-record?
- **Template system** — How do notice templates connect to the `type` field and field metadata?
- **Retry behavior** — How are failed deliveries retried?

## Customization

| Element | Reason | Decision |
|---|---|---|
| Entries judged by when they started | Without it, speech said off the record can be kept, or speech said on it dropped | [Decision 5](#decision-5-an-entry-is-judged-by-when-it-started) |
| One clock for every time | Comparing two clocks keeps or drops lines by the difference between them | [Decision 6](#decision-6-one-clock-the-softwares) |
| Entries do not change | The record could otherwise be rewritten after the fact | [Decision 7](#decision-7-entries-do-not-change) |
| What produced a transcript is recorded | The only way to judge a transcript's accuracy later | [Entity model](#transcript) |

### Including transcripts

A contract set includes transcripts by listing the `transcripts` capability in
its configuration. A set that does not has none of it.

### Speaker roles

The roles a line can name are a list the contract set replaces, so a benefits
program can say worker and applicant, and a hearing office hearing officer.

### Transcription services

The services a transcript can name are a registry a contract set extends with
its own entries.

### Profiles

A state chooses its profiles by overlaying the configuration the framework
provides, and adds or changes them through the API. A deploy adds only the
profiles not already there, so a change made through the API is kept.

A profile also sets how long a recording transcript may go without activity
before it closes itself. A profile that sets none leaves its transcripts open
until they are closed; the profiles the framework provides set 30 minutes.

## Out of scope

- **The transcription software** — signing in to the service, streaming
  audio, reconnecting, and turning the service's results into lines. That is
  code that belongs with the software that uses it. Whether it lives there or
  beside the transcription tools it is built from is open.
- **Capturing audio** — the microphone or the call window, which a browser grants
  only to the page.
- **Storing audio** — the blueprint keeps the record, not the recording.
- **Lines still being revised** — shown on the staff member's screen by the
  software, never stored.
- **Transcribing a recording after the fact** — a data exchange call (Decision 2).

## Capability coverage

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Live transcription of a conversation | Contact-center and meeting platforms transcribe calls as they happen | partial — the record and its rules; the software is out of scope |
| Telling speakers apart | Transcription services label speakers or channels | partial — each line keeps the service's label and a role mapped from it |
| Going off the record | Recording controls pause and resume | partial — pauses are kept in the timeline and enforced |
| Removing sensitive details from the text | Many services can redact personal information | gap |
| Closing an abandoned transcript | — | built — after the profile's idle timeout |

## References

- [Domain Design](domain-design.md) — Communication section in the domain overview
- [Inter-Domain Communication](../inter-domain-communication.md) — command vs. event pattern decision rule
- [Contract-Driven Architecture](../contract-driven-architecture.md) — contract artifacts and the adapter pattern
- [AI Services](../cross-cutting/ai-services.md) — how transcripts feed fact extraction and suggestions
- [Scheduling Service](../cross-cutting/scheduling-service.md) — the timers closing an abandoned transcript uses
- [IETF Idempotency-Key HTTP header draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
- [Amazon Transcribe streaming](https://docs.aws.amazon.com/transcribe/latest/dg/streaming.html)
