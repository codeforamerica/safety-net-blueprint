/**
 * The transcript audio adapter a state runs beside its server: it holds a
 * transcription service's secret and issues the short-lived connection the
 * page streams with. Never import this into a page. And, for a relay a state
 * runs, the check of the tokens the adapter signs for it.
 */
export { createTranscriptAudioAdapter, CantIssue } from './adapter.js';
export { awsTranscribeIssuer } from './issuers/aws/transcribe.js';
export { relayIssuer } from './issuers/relay.js';
export { generateRelayKey, verifyRelayToken, RelayTokenError } from './relay-token.js';
