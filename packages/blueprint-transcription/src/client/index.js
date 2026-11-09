/**
 * Transcription software that runs in the page: the driver, which is the only
 * part that talks to the transcription session, and the client adapters it
 * plugs in, one per transcription service and one for any relay, and audio
 * capture: the microphone, audio shared from a softphone, or a recording. The
 * fakes, for demos and tests, are in ./fakes.
 */
export { createTranscriptionClient, SessionError } from './driver.js';
export { createAwsTranscribeAdapter } from './adapters/aws/transcribe.js';
export { createRelayAdapter } from './adapters/relay.js';
export { RELAY_PROTOCOL } from '../relay-protocol.js';
export { captureAudio } from './audio/capture.js';
