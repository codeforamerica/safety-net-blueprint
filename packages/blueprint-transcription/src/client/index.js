/**
 * Transcription software that runs in the page: the driver, which is the only
 * part that talks to the transcription session, and the client adapters it
 * plugs in, one per transcription service.
 */
export { createTranscriptionClient, SessionError } from './driver.js';
export { createFakeAdapter } from './adapters/fake.js';
export { createAwsTranscribeAdapter } from './adapters/aws/transcribe.js';
export { createRelayAdapter } from './adapters/relay.js';
export { RELAY_PROTOCOL } from '../relay-protocol.js';
