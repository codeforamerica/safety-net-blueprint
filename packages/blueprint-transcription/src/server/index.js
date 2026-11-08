/**
 * The transcripts adapter a state runs beside its server: it holds a
 * transcription service's secret and issues the short-lived connection the
 * page streams with. Never import this into a page.
 */
export { createTranscriptsAdapter, CantIssue } from './adapter.js';
export { awsTranscribeIssuer } from './issuers/aws/transcribe.js';
export { createFakeRelay } from './relays/fake.js';
export { RELAY_PROTOCOL } from '../relay-protocol.js';
