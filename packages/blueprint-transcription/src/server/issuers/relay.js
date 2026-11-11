/**
 * Issues connections to a relay a state runs in front of a service a browser
 * can't reach: the relay's address, its subprotocol, and a short-lived token
 * the adapter signs itself, which the relay checks against the adapter's
 * published keys. No call to the service: the relay holds its credentials.
 * See communication-transcripts-relay-asyncapi.yaml.
 */

import { RELAY_PROTOCOL } from '../../relay-protocol.js';
import { CantIssue } from '../adapter.js';
import { publicKeyOf, signRelayToken } from '../relay-token.js';

/** The longest a relay token may be good for, in seconds: the relay contract's minute. */
const MOST = 60;

/**
 * @param {object} options
 * @param {string} options.url - the relay's WebSocket URL
 * @param {object} options.privateKey - a private JWK, from generateRelayKey
 * @param {string} [options.audience] - what the relay checks the token is for; its URL by default
 * @param {number} [options.expiresIn] - seconds; at most 60
 * @param {Function} [options.now]
 * @returns {((request: object) => Promise<object>) & { publicKey: object }}
 *   from a ConnectionRequest to a StreamConnection, with the public key the
 *   adapter publishes for it
 */
export function relayIssuer({ url, privateKey, audience = url, expiresIn = MOST, now = () => new Date() }) {
  if (!url) throw new Error('relayIssuer: give the relay\'s url');
  if (!privateKey?.d || !privateKey.kid) throw new Error('relayIssuer: give a private JWK with a kid, from generateRelayKey');
  if (expiresIn > MOST) throw new Error(`relayIssuer: a relay token lasts at most ${MOST} seconds`);

  const issue = async ({ provider, protocols, languages, model }) => {
    if (!protocols.includes('websocket')) throw new CantIssue('A relay is reached over a WebSocket only', 'protocols');
    const parameters = { ...(languages && { languages }), ...(model && { model }) };
    return {
      provider,
      protocol: 'websocket',
      url,
      subprotocol: RELAY_PROTOCOL,
      accessToken: await signRelayToken({ privateKey, audience, expiresIn, now: now() }),
      tokenType: 'Bearer',
      expiresIn,
      ...(Object.keys(parameters).length && { connectionParameters: parameters }),
    };
  };
  issue.publicKey = publicKeyOf(privateKey);
  return issue;
}
