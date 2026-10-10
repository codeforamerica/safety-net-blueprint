# Transcripts (Cross-Cutting)

> **Status: draft.** No contract exists yet. This is the design the contract
> will be written from, including the rules a transcription client is held to.

See [AI Services](ai-services.md) for how transcripts fit with suggestions,
fact extraction and the interview, and [Contract-Driven Architecture](../contract-driven-architecture.md)
for the contract approach.

## Overview

A transcript is the written record of a conversation: who said what, and when.
It is not tied to audio — a chat or text-message interview produces one too —
and what comes after it, fact extraction, suggestions and the words quoted as
evidence, needs only the lines, not how they were captured. Producing one from
speech is the job of a transcription client in the page, outside the blueprint.

The first use is the interview assistant: a worker interviews an applicant, and
the transcript is what the assistant works from.

## What is a contract

| Part | Where | Why |
|---|---|---|
| The transcript — its states, lines and gaps | A contract: a resource and state machine | Everything after the conversation relies on it |
| Its settings — provider, language, custom vocabulary, which audio channel is the worker and which the applicant, the audio format | A contract: a config catalog entry, overlaid per environment | The client reads them from the blueprint, so changing Transcribe for Scribe is configuration |
| The client — signing, streaming audio to the provider, decoding its results | Code, with the application that uses it. The transcription tools' `sigv4.js` and `eventstream.js` are most of it | It speaks the provider's protocol, and nothing in the blueprint does |
| The connection to the provider — starting, reconnecting, interrupted | Inside the client | It describes a WebSocket, not the conversation |
| Capture — the microphone, the shared call window | Page code | A browser grants these only to page code, on a click |

The application joins the client to the transcript in a few dozen lines: read
the settings, map the provider's speaker labels to roles, add each finished line
and any gap, and pause, resume and close.

## How it fits together

```
 Page                                     Mock (contracts)
 ────                                     ────────────────
 sign-in (Cognito) ── AWS credentials
 capture (microphone)
 transcription client ── audio ──► provider
        │          ◄── results ──
        │
        ├── start / pause / resume / close ──►  Transcript
        ├── finished line ───────────────────►    lines
        └── gap ─────────────────────────────►    gaps
                                                  │
 worker's screen ◄────── SSE event stream ────────┘
```

Audio goes from the page straight to the provider. What reaches the blueprint is
what the client reports about the conversation, and the event stream carries it
to the worker's screen and anything else listening.

## The resource

A transcript refers to what it records — for the interview assistant, the
`Interview` — and records which client and provider produced it.

- **States:** `recording`, `paused` and `closed`. A pause is deliberate: an
  applicant may ask to go off the record. Once the `Interview` exists, starting
  and resuming are guarded on consent recorded on it.
- **Lines**, listed under the transcript. Each has an id the client generates;
  a speaker role — worker, applicant or unknown — and the provider's own speaker
  label, since with one microphone in a room the provider labels speakers
  `spk_0` and `spk_1` and something has to map them; the text; when it was
  spoken; and whether it was spoken or typed. Fields that apply only to speech,
  such as a confidence, are optional.
- **Gaps**, where the conversation went untranscribed, each with a start and an
  end. A gap is unintended and a pause is chosen, so the two are kept apart.
- **Events:** each operation emits one — line added, gap recorded, paused,
  resumed, closed — on the platform event stream.

Lines are records under the transcript, not stored events, so a transcript
lists and pages like any other resource. An hour-long interview is on the order
of a thousand finished lines.

**Only finished lines reach the blueprint.** Lines still firming up arrive
several times a second, and the worker's own screen gets them from the client
directly. If something else ever needs them live, they would be broadcast and
not stored — see [Events](ai-services.md#events).

## Dropped connections

A dropped connection is not an event. Whether it loses anything depends on the
client: one that buffers audio while it reconnects, and sends the backlog, loses
nothing. What matters to anyone relying on the transcript is whether it is
complete, so the contract records the outcome — a gap — whatever caused it: a
dropped connection, a provider failure, a suspended tab.

The client learns where a gap ends only once transcription works again, so it
records the gap once, with both times, when transcription comes back or when the
transcript closes.

A "reconnecting" notice on the worker's screen comes from the client. If someone
else ever needs to see it live — a supervisor, say — that is a broadcast-only
status event, never part of the resource.

## When the client is unreliable

The blueprint cannot make a client reliable. It refuses what is inconsistent,
cleans up what is abandoned, and records what produced each transcript.

| The client | The blueprint |
|---|---|
| Adds a line after closing | Refuses it |
| Adds a line spoken while paused | Refuses it, so even a faulty client cannot get speech stored while the conversation is off the record |
| Forgets to resume, and keeps adding lines | Refuses them, so the client finds out |
| Sends the same line twice on a retry | Keeps one, by the line's id |
| Sends lines out of order | Orders them by when they were spoken |
| Never closes — the tab closed, the browser crashed | Closes it: after a configured time with no activity, by a declared timer, and when the `Interview` completes, by reacting to `interview.completed`. Either way it records a gap from the last line to the close, so the record shows it ended abnormally |

**A line is judged by when it was spoken, not when it arrives.** A provider
finalizes a line a second or two after it is said, so a line spoken just before
a pause can arrive just after it. It is accepted if the time it was spoken falls
in a recording period, and refused if that time falls in a pause or after the
close. Judging by arrival would be simpler, but would drop real speech from any
client that does not send its pending lines before pausing — and the client is
already trusted for the time on every line.

**What the blueprint cannot know** is whether the client told the truth. A
client that never pauses, or never reports a gap, looks the same as a
conversation that stayed on the record without a break. That is true of any API:
it validates what it is told, not what happened. Two things bound it: the
transcript records which client and provider produced it, and the worker — the
one person who was there — sees the transcript.

## Where it lives

**The framework's platform domain, beside Suggestion.** A transcript has nothing
benefits-specific in it, and more than an interview has one — a caseworker's
call on an existing case, a fair hearing. In intake, another domain could not
use it, and since intake is in `safety-net-contracts`, neither could another
contract set. The `Interview` refers to its transcript. Its settings are a
config catalog entry on the same domain.

Platform gets no subdomain for these: domains are flat, and the domain name runs
through route ownership, event names, forwarding and overlays, so nesting would
be a large framework change for two resources. OpenAPI tags group them for
reading.

**Not Data Exchange, which models a request and a single answer.** Something in
the blueprint submits a call, an adapter performs it, and one result comes back
— `conclusive`, `inconclusive`, `partial` or `error` — announced as
`call.completed`, `call.failed` or `call.timed_out`. A live transcript is
started by a worker, not the blueprint; written by a client, not an adapter; and
grows line by line over an hour, with pauses and gaps the call lifecycle has no
place for. Forcing it in would mean one call left open for the whole interview,
and a lifecycle for one service type unlike every other.

Data Exchange does fit **transcribing a recording after the fact** — a recorded
call or a hearing, uploaded. That is a request and a single answer: the
blueprint submits a `transcription` call with the audio, an adapter sends it to
a batch transcription service, and the result fills a Transcript. So live and
batch transcription end in the same resource by two routes. Fact extraction,
which reads a transcript, is a Data Exchange call too.

## Why the audio stream stays out of the mock

The mock could run the stream — in a page, `mock.fetch` is a function call, so a
request whose body is live audio reaches the mock with no network hop — but it
should not, for three reasons:

- **Providers design for the browser connecting directly.** AWS documents
  streaming to Transcribe from a browser with identity-pool credentials, and
  ElevenLabs issues single-use tokens so a browser can connect to Scribe.
  Relaying audio adds latency and cost, so a real system would not, and a mock
  that did would be imitating a step no real system has.
- **It would make the mock a real implementation.** The mock stands in for the
  blueprint's own endpoints, as its event stream does. Speaking a provider's
  binary protocol would put the most provider-specific code in the system into a
  vendor-neutral package.
- **It only works in a page.** Against the Node mock, the browser would have to
  stream an upload over the network, which not every browser supports.

A state that wanted audio kept off workers' machines would run a real service
implementing the transcript contract, and forward to it; that is still not the
mock.

## Open questions

- How a contract set's own platform domain extends the framework's, and whether
  the build can merge two domains of the same name.
- Where the transcription client lives: with the application that uses it, or
  beside the transcription tools it is built from.
- How long a recording transcript may go without activity before it closes
  itself.
