# Transcripts (Cross-Cutting)

> **Status: draft, partly built.** The transcript, its lifecycle and its
> timeline exist, in the framework's `transcription` domain
> (`blueprint-core/base-contracts/domains/transcription/`). Settings and closing
> an abandoned transcript are to come, as this design describes.

See [AI Services](ai-services.md) for how transcripts fit with suggestions,
fact extraction and the interview, and [Contract-Driven Architecture](../contract-driven-architecture.md)
for the contract approach.

## Overview

A transcript is the written record of one conversation: who said what, and
when, including the stretches that were off the record and the stretches that
were lost. It is not tied to audio — a chat or a text-message interview produces
one too — and everything that comes after it, from fact extraction to the words
quoted as evidence for a suggestion, needs only the record, not how it was
captured. The first use is the interview assistant: a worker interviews an
applicant, and the transcript is what the assistant works from. The blueprint
holds the record and the rules for keeping it; turning speech into text is done
by a transcription service the worker's application talks to directly.

## What happens during a transcribed conversation

1. The worker starts a transcript for the conversation — an interview, say —
   and the application begins sending the audio to a transcription service.
2. As each sentence is finished, the application adds it to the transcript, with
   when it was said and who said it.
3. If the applicant asks to go off the record, the worker pauses the transcript.
   Nothing said while paused is kept. When they resume, recording continues.
4. If transcription drops out — a lost connection, a service failure — the
   application records the stretch that was lost once transcription works again.
5. Anyone following along, such as the worker's own screen, sees each change as
   it happens.
6. When the conversation ends, the worker closes the transcript. Nothing more is
   added after that.

## Entity model

### Transcript

The record of one conversation.

- **What it records** — the conversation it belongs to, such as an interview,
  and what kind of thing that is. A transcript is reused across conversation
  types — interviews, calls on an existing case, fair hearings — so it names its
  subject rather than belonging to one.
- **What produced it** — the application that wrote it, the transcription
  service, and the service's model. Two transcripts made a month apart by the
  same service can differ because the service changed its model, and anyone
  judging a transcript's accuracy needs to know which produced it. A typed
  conversation records that no service was involved.
- **When it started and closed** — by the application's clock, the same clock
  every time on its entries uses, so every comparison is between times from one
  clock.
- **Status** — recording, paused or closed. See the lifecycle below.

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
- **Cause** (gaps) — why nothing was captured, as far as the application knows:
  the connection, the service, the application, or unknown. It shows how
  reliable a transcript is.

## Transcript lifecycle

| State | Description | SLA clock |
|---|---|---|
| Recording | The conversation is on the record; lines are accepted. | none |
| Paused | The conversation is off the record, usually because the applicant asked. Nothing said now is kept. | none |
| Closed | The conversation has ended. Terminal. | none |

A transcript starts recording. Pausing moves it to paused and begins a pause in
its timeline; resuming returns it to recording and ends that pause. Closing, from
either state, ends it — and ends a pause still open.

What a transcript accepts follows from the lifecycle:

| The application | The transcript |
|---|---|
| Adds a line said while recording | Keeps it — even if it arrives after a pause began |
| Adds a line said while paused, or after closing | Refuses it |
| Adds a line that ends before it starts | Refuses it |
| Records a lost stretch that overlaps a pause | Refuses it: the pause already accounts for that time |
| Sends the same line again on a retry | Keeps one |
| Sends lines out of order | Lists them in the order they were said |
| Changes an entry once written | Refuses it. Only the lifecycle ends a pause |
| Never closes — the browser closed, the machine crashed | *Planned:* closes it after a configured time without activity, recording the lost stretch, so the record shows it ended abnormally |

A refusal names the rule that did not hold.

## Domain events

| Event | Why it's needed | Trigger | Primary consumers |
|---|---|---|---|
| `transcription.transcript.created` | A conversation began being recorded | Starting a transcript | The worker's screen; anything that will read the transcript |
| `transcription.transcript.paused` | The conversation went off the record | Pausing | The worker's screen; audit |
| `transcription.transcript.resumed` | It is back on the record | Resuming | The worker's screen; audit |
| `transcription.transcript.closed` | The record is complete, so work that needs the whole conversation can begin | Closing | Fact extraction and suggestions |
| `transcription.transcript_entry.created` | A line, a lost stretch or a pause was added | Adding an entry, or pausing | The worker's screen; anything reading the conversation live |
| `transcription.transcript_entry.updated` | A pause ended | Resuming, or closing while paused | The worker's screen |
| `transcription.transcript.updated` / `.deleted` | What a transcript records was corrected, or it was removed | Updating or deleting it | Audit |

## Contract artifacts

All in `blueprint-core/base-contracts/domains/transcription/`.

| Artifact | File |
|---|---|
| API — transcripts and their entries | `transcription-transcripts-openapi.yaml` |
| Lifecycle and the rules for entries | `transcription-transcripts-state-machine.yaml` |
| Events | `transcription-transcripts-asyncapi.yaml` |
| Transcription services | `transcription-registry-transcription-services.yaml` |
| Sample transcripts | `transcription-mock-data.yaml` |

## Key design decisions

| # | Decision | Summary |
|---|---|---|
| 1 | [A framework domain of its own](#decision-1-a-framework-domain-of-its-own) | Transcription is a capability the framework provides and a contract set opts into |
| 2 | [Live transcription is not a data exchange call](#decision-2-live-transcription-is-not-a-data-exchange-call) | Its own resource; recordings transcribed after the fact can still use data exchange |
| 3 | [Audio never passes through the blueprint](#decision-3-audio-never-passes-through-the-blueprint) | The application streams audio to the service; the blueprint receives finished lines |
| 4 | [One timeline of entries](#decision-4-one-timeline-of-entries) | Lines, lost stretches and pauses in one ordered list |
| 5 | [An entry is judged by when it started](#decision-5-an-entry-is-judged-by-when-it-started) | Not by when it arrives |
| 6 | [One clock: the application's](#decision-6-one-clock-the-applications) | Every time on a transcript comes from the application |
| 7 | [Entries do not change](#decision-7-entries-do-not-change) | Only the lifecycle ends a pause |
| 8 | [A retry is recognized by a key](#decision-8-a-retry-is-recognized-by-a-key) | The application sends the same key when it retries |
| 9 | [A dropped connection is a gap, not an event](#decision-9-a-dropped-connection-is-a-gap-not-an-event) | The record shows what was lost, whatever caused it |

### Decision 1: A framework domain of its own

**Status:** Decided: C

**What's being decided:** A transcript has nothing benefits-specific in it and
is needed by more than the interview, so where it is defined decides who can
use it.

**Considerations:**
- Interviews, calls on an existing case and fair hearings all produce
  conversations worth a record, across domains and across contract sets.
- Platform holds infrastructure every domain plugs into — the event log,
  registries. A transcript is a capability some domains use, with its own
  records, lifecycle and rules, the way scheduling and document management are.
- A contract set that never transcribes anything should carry none of it.

**Options:**
- **(A)** In intake, beside the interview. Another domain could not use it, and
  since intake belongs to one contract set, neither could another set.
- **(B)** In the framework's platform domain. Every contract set would get it,
  needed or not.
- **(C) ✓** In a `transcription` domain the framework provides, which a contract
  set includes by listing it as a capability.

### Decision 2: Live transcription is not a data exchange call

**Status:** Decided: B

**What's being decided:** Data exchange already models calls to outside
services, so whether a live transcript is one of those calls decides whether it
gets a resource and lifecycle of its own.

**Considerations:**
- A data exchange call is a request and one answer: the blueprint submits it,
  an adapter performs it, one result comes back.
- A live transcript is started by a worker, written by the worker's application,
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
- **(A)** The application sends audio to the blueprint, which relays it to the
  service and writes the lines itself.
- **(B) ✓** The application streams audio straight to the service and adds each
  finished line to the transcript. A state that wants audio kept off workers'
  machines runs a service that implements the transcript contract and
  transcribes on its side.

**Decision:** Only finished lines reach the blueprint. Lines still being
revised arrive several times a second, and the worker's own screen gets them
from the application directly.

### Decision 4: One timeline of entries

**Status:** Decided: B

**What's being decided:** A transcript holds lines, stretches that were lost and
stretches that were off the record, so how they are stored decides how anyone
reads the whole conversation.

**Considerations:**
- A reader — a worker, a reviewer, fact extraction — needs the conversation in
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
- The application is already trusted for when every line was said.
- A line can begin on the record and run past the moment the worker paused.
- The point of pausing is that nothing said off the record is kept, even by a
  faulty application.

**Options:**
- **(A)** By when it arrives. Simpler, but drops real speech from any
  application that does not send its pending lines before pausing.
- **(B) ✓** By when it started: kept if it started while recording. A few words
  said just after the pause may be kept with the sentence they finish.
- **(C)** By its whole period: refused if any part overlaps a pause. Nothing said
  after the pause is kept, but neither is the sentence it ended.

### Decision 6: One clock: the application's

**Status:** Decided: B

**What's being decided:** Lines carry the application's times while the server
has a clock of its own, so which clock marks the start, pauses and close decides
whether a rule ever compares two clocks.

**Considerations:**
- Two computers' clocks differ by seconds. A rule comparing a line's time with a
  pause the server timed would keep or drop lines by that difference.
- An application that misreports when it paused could equally misreport when a
  line was said, so trusting it for both adds no new trust.

**Options:**
- **(A)** The server times the start, pauses and close; the application times
  lines. Two clocks, compared.
- **(B) ✓** The application times everything. The server keeps its own record of
  when it received things, for auditing.
- **(C)** Judge by when things arrive, with a few seconds' grace after a pause.
  One clock, but a faulty application gets a few seconds of off-the-record
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

**What's being decided:** An application whose connection drops before it hears
back sends a line again, so how a repeat is recognized decides whether the
transcript gets the line twice.

**Considerations:**
- Payment and cloud APIs recognize retries by a key the client sends with each
  request, the same on every retry; an internet standard for it is in draft.
- Every other record in the blueprint gets its identifier from the server.
- Two people can start speaking at the same instant, so a line's start time
  does not identify it.

**Options:**
- **(A)** The application chooses each entry's identifier.
- **(B) ✓** The application sends a key with each line it adds, and the same key
  on a retry; a repeat gets the first answer back.
- **(C)** A line's start time and speaker together.

### Decision 9: A dropped connection is a gap, not an event

**Status:** Decided: B

**What's being decided:** Whether a dropped connection loses anything depends on
the application — one that buffers audio and sends the backlog loses nothing —
so what the record notes decides what a reader can rely on.

**Considerations:**
- What matters to anyone relying on the transcript is whether it is complete.
- The application learns where a lost stretch ends only once transcription works
  again.

**Options:**
- **(A)** Record each connection change.
- **(B) ✓** Record the outcome: a lost stretch, with both times, once
  transcription comes back or the transcript closes, whatever caused it. A
  "reconnecting" notice on the worker's screen comes from the application.

## Customization

| Element | Reason | Decision |
|---|---|---|
| Entries judged by when they started | Without it, speech said off the record can be kept, or speech said on it dropped | [Decision 5](#decision-5-an-entry-is-judged-by-when-it-started) |
| One clock for every time | Comparing two clocks keeps or drops lines by the difference between them | [Decision 6](#decision-6-one-clock-the-applications) |
| Entries do not change | The record could otherwise be rewritten after the fact | [Decision 7](#decision-7-entries-do-not-change) |
| What produced a transcript is recorded | The only way to judge a transcript's accuracy later | [Entity model](#transcript) |

### Including transcription

A contract set includes transcription by listing it as a capability in its
configuration. A set that does not has none of it.

### Speaker roles

The roles a line can name are a list the contract set replaces, so a benefits
program can say worker and applicant, and a hearing office hearing officer.

### Transcription services

The services a transcript can name are a registry a contract set extends with
its own entries.

### Settings

*Planned:* the service, language, custom vocabulary, which audio channel is
which speaker, and how long a transcript may go without activity before it
closes itself, as configuration a state sets per environment.

## Out of scope

- **The transcription application** — signing in to the service, streaming
  audio, reconnecting, and turning the service's results into lines. That is
  application code, with the application that uses it. Whether it lives there or
  beside the transcription tools it is built from is open.
- **Capturing audio** — the microphone or the call window, which a browser grants
  only to the page.
- **Storing audio** — the blueprint keeps the record, not the recording.
- **Lines still being revised** — shown on the worker's screen by the
  application, never stored.
- **Transcribing a recording after the fact** — a data exchange call (Decision 2).

## Capability coverage

| Capability | Industry standard | Blueprint status |
|---|---|---|
| Live transcription of a conversation | Contact-center and meeting platforms transcribe calls as they happen | partial — the record and its rules; the application is out of scope |
| Telling speakers apart | Transcription services label speakers or channels | partial — each line keeps the service's label and a role mapped from it |
| Going off the record | Recording controls pause and resume | partial — pauses are kept in the timeline and enforced |
| Removing sensitive details from the text | Many services can redact personal information | gap |
| Closing an abandoned transcript | — | planned |

## References

- [AI Services](ai-services.md) — how transcripts feed fact extraction and suggestions
- [Scheduling Service](scheduling-service.md) — the timers closing an abandoned transcript will use
- [IETF Idempotency-Key HTTP header draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
- [Amazon Transcribe streaming](https://docs.aws.amazon.com/transcribe/latest/dg/streaming.html)
