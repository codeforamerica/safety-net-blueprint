/**
 * Issues connections to Amazon Transcribe streaming: a presigned WebSocket
 * URL that carries its own credential, so no AWS credential reaches the page.
 * https://docs.aws.amazon.com/transcribe/latest/dg/websocket.html
 */

import { presignUrl } from './sigv4.js';
import { CantIssue } from '../../adapter.js';

/** Transcribe's names for the encodings it streams. */
const ENCODINGS = { linear16: 'pcm', ogg_opus: 'ogg-opus', flac: 'flac' };

/** The longest a Transcribe presigned URL may be good for, in seconds. */
const MOST = 300;

const fromEnvironment = () => {
  const env = globalThis.process?.env ?? {};
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('No AWS credentials: give `credentials`, or set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
  }
  return { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, sessionToken: env.AWS_SESSION_TOKEN };
};

/**
 * @param {object} options
 * @param {string} options.region
 * @param {object|Function} [options.credentials] - AWS credentials, or a
 *   function that gets them (from a role, say); the environment's by default.
 * @param {string} [options.languageCode] - used when a request names no language
 * @param {number} [options.expiresIn] - seconds; at most 300
 * @param {Record<string, string>} [options.settings] - other query parameters
 *   Transcribe takes, by its names, such as `vocabulary-name` or `show-speaker-label`
 * @param {Function} [options.now]
 * @returns {(request: object) => Promise<object>} from a ConnectionRequest to a StreamConnection
 */
export function awsTranscribeIssuer({
  region,
  credentials = fromEnvironment,
  languageCode,
  expiresIn = MOST,
  settings = {},
  now = () => new Date(),
}) {
  if (!region) throw new Error('awsTranscribeIssuer: give a region');
  if (expiresIn > MOST) throw new Error(`awsTranscribeIssuer: Transcribe takes expiresIn up to ${MOST} seconds`);

  return async ({ audio, protocols, languages }) => {
    if (!protocols.includes('websocket')) throw new CantIssue('Amazon Transcribe streams to a browser over a WebSocket only', 'protocols');
    const encoding = ENCODINGS[audio.encoding];
    if (!encoding) throw new CantIssue(`Amazon Transcribe doesn't stream ${audio.encoding}; it takes ${Object.keys(ENCODINGS).join(', ')}`, 'audio.encoding');
    if (audio.channelCount > 2) throw new CantIssue('Amazon Transcribe takes one channel or two', 'audio.channelCount');

    const query = { 'media-encoding': encoding, 'sample-rate': String(audio.sampleRateHertz), ...settings };
    if (audio.channelCount === 2) Object.assign(query, { 'enable-channel-identification': 'true', 'number-of-channels': '2' });
    if (languages?.length > 1) Object.assign(query, { 'identify-language': 'true', 'language-options': languages.join(',') });
    else if (languages?.length === 1) query['language-code'] = languages[0];
    else if (languageCode) query['language-code'] = languageCode;
    else throw new CantIssue('Amazon Transcribe needs a language, or several to choose among', 'languages');

    const url = await presignUrl({
      protocol: 'wss:',
      host: `transcribestreaming.${region}.amazonaws.com:8443`,
      path: '/stream-transcription-websocket',
      query,
      service: 'transcribe',
      region,
      credentials: typeof credentials === 'function' ? await credentials() : credentials,
      expiresIn,
      now: now(),
    });
    return { provider: 'aws-transcribe', protocol: 'websocket', url, expiresIn };
  };
}
