// What an app and an adapter write with an API's typed events. Checked by
// tests/unit/typed-events.test.js with tsc: every line must compile, and each
// line marked as an expected error must be one.
import { Events } from '../../../../blueprint-harness/generated/clients/communication-transcription-sessions/index.js';

declare const event: { type: string; data?: unknown };

// A subscriber narrows an event by its type, its data with it.
if (Events.is(event, 'communication.transcription_session.line_finished')) {
  const text: string = event.data.text;
  const key: string = event.data.key;
  // @ts-expect-error — a line's text is a string
  const wrong: number = event.data.text;
  void wrong;
  void text; void key;
}

// An adapter publishes an event, its data checked by its type.
Events.publish('communication.transcription_session.line_finished', {
  transcriptId: '7a1e0c2d-0000-4000-8000-0000000000c1', key: 'l1', text: 'Hello.', speaker: 'staff',
  startedAt: '2026-10-12T10:00:01Z', endedAt: '2026-10-12T10:00:02Z',
}, { subject: '7a1e0c2d-0000-4000-8000-0000000000c9' });

// @ts-expect-error — a finished line needs its text
Events.publish('communication.transcription_session.line_finished', {
  transcriptId: '7a1e0c2d-0000-4000-8000-0000000000c1', key: 'l1', speaker: 'staff',
  startedAt: '2026-10-12T10:00:01Z', endedAt: '2026-10-12T10:00:02Z',
}, { subject: 's' });

// @ts-expect-error — no event of this API has this type
Events.publish('communication.transcription_session.nope', {}, { subject: 's' });
