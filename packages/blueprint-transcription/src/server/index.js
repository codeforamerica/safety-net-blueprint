/**
 * The transcripts adapter a state runs beside its server: it holds a
 * transcription service's secret and issues the short-lived connection the
 * page streams with. Never import this into a page.
 */
export { createTranscriptsAdapter, CantIssue } from './adapter.js';
export { transcribeIssuer } from './transcribe.js';
