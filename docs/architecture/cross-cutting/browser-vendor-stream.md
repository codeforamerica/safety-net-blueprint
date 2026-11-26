# Browser-to-Vendor Stream

How the blueprint handles something live that a browser streams to a vendor,
such as speech to a transcription service, while the blueprint keeps the
result. The rules are in
[`docs/conventions/patterns/browser-vendor-stream.yaml`](../../conventions/patterns/browser-vendor-stream.yaml);
this doc says why each one is there. Transcription is the first use, in the
[communication domain](../domains/communication-transcripts.md#how-the-parts-work-together).

## When it fits

Use it when all of these hold:

- **The browser and a vendor exchange a live, continuous stream** — audio,
  video, a real-time conversation — where delay matters.
- **The raw stream shouldn't pass through the server.** Passing it through
  adds delay and cost, and the blueprint would have to hold something it
  doesn't need.
- **What's kept is a result derived from the stream,** such as text, not the
  stream itself.
- **The connection belongs to one browser tab** and doesn't need to outlive it.
- **The vendor issues browsers short-lived credentials,** or the state runs a
  server the browser can reach in front of one that doesn't.

## When it doesn't

| Situation | Use instead |
|---|---|
| One request and one answer, such as checking a fact with an outside authority | The [adapter pattern](adapters.md), or Data Exchange |
| Content that's already stored, such as an uploaded document, or a recording transcribed after the fact | A server-side adapter that reads it |
| The raw stream has to be kept or audited | Stream through the state's own server and keep it there |
| The connection has to outlive the tab, or continue with no page open | A session on the server |

A stream with no notion of "off the record" can leave out pausing.

## The parts

| Part | Where it runs | Defined by | What it does |
|---|---|---|---|
| Page | Browser | The app | The user's screen; calls only the session's actions, and follows its events |
| Session | Browser, kept there by routing | The blueprint: OpenAPI and a state machine | Tracks the connection; starts, pauses and stops its adapter, and follows what the adapter publishes |
| Session adapter, streaming part | Browser | The blueprint's contract; the app or the state implements it for one vendor | Streams to the vendor and publishes the session's events: connected, each draft and finished result, ended |
| The record | Server | The blueprint: OpenAPI and a state machine | Keeps the finished results, which it follows, and its rules |
| Session adapter, credentials part | Beside the server | The blueprint's contract; the state implements it | Holds the vendor's secret and issues a short-lived credential |

## Why each rule

**The session runs in the page, kept there by routing.** It tracks one tab's
connection, which ends with the tab, and drafts of the result have to stay in
the browser. The record, which lasts, belongs on the server. The same contracts
run in either place; routing — per-environment configuration — decides where,
so no contract says where it runs, and a demo with no backend runs everything
in the page.

**The session's API is what the app does.** Start, pause, resume and stop are
the only operations, because they're the only things an app decides. What the
connection does — opening, dropping, a line heard — isn't a request anyone
makes; it's something that happened, so it isn't an operation.

**The adapter is the session's implementation, and it reports with events.**
The session calls its adapter to start, pause and stop, and the adapter
publishes the session's own events as things happen: connected, disconnected,
each draft and finished line, ended. The session follows them, and so does
anything else interested. One adapter per vendor, behind one session, keeps
the contracts vendor-neutral. See [a running adapter](adapters.md#a-running-adapter).

**The record follows the finished results.** The transcript, not the session,
decides what it keeps: it follows each finished line and adds it, once, by the
session and the line's key. "The adapter finished a line" and "the transcript
kept it" are two facts with two owners, so two events
([who publishes an event](../inter-domain-communication.md#who-publishes-an-event)).
When the record is on a server, the adapter's events reach it through
`publishEvent`, which brings the checks in
[events from outside the server](../inter-domain-communication.md#events-from-outside-the-server).

**Only finished results are kept.** A draft is revised several times a
second and is the least reliable text there is; some never finish; and
whatever reads the record should see only what was finally heard. Drafts are
events nothing keeps; the finished result is kept once, tied to its drafts by
a key the adapter gives, so one published again keeps it once.

**The adapter's credentials part issues the credential.** Vendors design for
browsers connecting directly, with short-lived credentials, but issuing one
takes the vendor's secret, which can't be in a page. The credentials part holds it
and answers in one shape for every vendor, named as OAuth names a token
response. The streaming part asks for one when it starts, and again to renew it or
reconnect. A vendor that takes no credential, such as a model running in the
page, needs no credentials part.

**Only the adapter says the connection opened.** The blueprint never touches
the stream, so only the adapter knows whether the connection opened, and it
publishes `connected` when it does. Between start and that, the session is
`connecting`, so a connection that fails to open has somewhere to land.

**A vendor a browser can't reach is the adapter's business.** Some vendors
take only gRPC, and a model a state runs itself has no browser credentials.
The state runs a server in front of one, and that vendor's adapter streams to
it. How the adapter and that server talk is theirs to choose: the session sees
the same calls and events either way, so the blueprint defines no contract
for it.

**States come from a standard, and an action, its state and its event share one
word.** W3C WebRTC names a connection's states, and a developer already knows
them; where its word disagrees with the action, the session uses the word that
agrees, so `stop` leads to `stopping`. See
[naming](../../conventions/naming.yaml), `state_machine_names`.

**Going off the record stops the stream to the vendor.** Someone who asks to go
off the record expects not to be heard, not only not to be written down, and a
vendor that receives the stream may keep it. Disconnecting works the same with
every vendor; keeping a quiet connection open is done differently by each.

## Where it's used

- **Transcription**, in the communication domain: the transcription session,
  the transcript and the transcription session adapter. Its decisions
  are [Decisions 3 and 11 to 17](../domains/communication-transcripts.md#key-design-decisions).
