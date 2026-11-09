/**
 * Fakes, in the testing sense: working parts with no transcription service
 * behind them, for demos and tests. They hold no secrets, so they run in a
 * page or on a server. Each plays back a recording (src/recording.js).
 */
export { createFakeAdapter } from './adapter.js';
export { createFakeRelay } from './relay.js';
export { createInPageSocket } from './socket.js';
