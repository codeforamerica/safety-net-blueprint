// Generated from the events document beside this API. Do not edit.
import type { CommunicationTranscriptionSessionCreatedEvent, CommunicationTranscriptionSessionConnectingEvent, CommunicationTranscriptionSessionConnectedEvent, CommunicationTranscriptionSessionDisconnectedEvent, CommunicationTranscriptionSessionFailedEvent, CommunicationTranscriptionSessionLineUpdatedEvent, CommunicationTranscriptionSessionLineFinishedEvent, CommunicationTranscriptionSessionEndedEvent, CommunicationTranscriptionSessionPausedEvent, CommunicationTranscriptionSessionStoppingEvent, CommunicationTranscriptionSessionClosedEvent } from './events/types.gen.js';
import { publishEvent } from '../platform-events/index.js';

/** Every event this API sends. */
export type Event =
  | CommunicationTranscriptionSessionCreatedEvent
  | CommunicationTranscriptionSessionConnectingEvent
  | CommunicationTranscriptionSessionConnectedEvent
  | CommunicationTranscriptionSessionDisconnectedEvent
  | CommunicationTranscriptionSessionFailedEvent
  | CommunicationTranscriptionSessionLineUpdatedEvent
  | CommunicationTranscriptionSessionLineFinishedEvent
  | CommunicationTranscriptionSessionEndedEvent
  | CommunicationTranscriptionSessionPausedEvent
  | CommunicationTranscriptionSessionStoppingEvent
  | CommunicationTranscriptionSessionClosedEvent;

/** The type of every event this API sends. */
export type EventType = Event['type'];

/** The event of one type. */
export type EventOf<T extends EventType> = Extract<Event, { type: T }>;

/**
 * Whether an event is of a type, narrowing it, its data included:
 * `if (Events.is(event, 'communication.transcription_session.line_finished')) event.data.text`.
 */
export function is<T extends EventType>(event: { type?: string } | null | undefined, type: T): event is EventOf<T> {
  return event?.type === type;
}

/**
 * Publish an event of this API, through the platform's publishEvent, with its
 * data checked by its type. The subject is the record it's about, and the
 * partition key, which keeps one subject's events in order, defaults to it.
 */
export function publish<T extends EventType>(
  type: T,
  data: EventOf<T>['data'],
  options: { subject: string; partitionkey?: string; source?: string; client?: Parameters<typeof publishEvent>[0]['client'] },
) {
  const { subject, partitionkey = subject, source = `/${type.split('.')[0]}`, client } = options;
  return publishEvent({
    client,
    body: {
      specversion: '1.0', id: crypto.randomUUID(), source, type, subject, partitionkey,
      time: new Date().toISOString(), datacontenttype: 'application/json', data,
    } as Parameters<typeof publishEvent>[0]['body'],
  });
}
