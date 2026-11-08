/**
 * AWS Signature Version 4, query-string form: a presigned URL, as Amazon
 * Transcribe's streaming WebSocket takes. Written to AWS's published
 * specification rather than taken from the AWS SDK, so the package carries no
 * dependency for one URL; its tests check it against AWS's own signer.
 *
 * Uses Web Crypto, so it runs in Node, a serverless function or a worker.
 * https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
 */

const encoder = new TextEncoder();

const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (text) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));

async function hmac(key, text) {
  const imported = await crypto.subtle.importKey(
    'raw', typeof key === 'string' ? encoder.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return crypto.subtle.sign('HMAC', imported, encoder.encode(text));
}

// RFC 3986 unreserved characters stay; everything else is percent-encoded,
// which is stricter than encodeURIComponent (it leaves !'()* alone).
const encode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * @param {object} options
 * @param {string} options.protocol - `wss:` or `https:`
 * @param {string} options.host - including a port that isn't the default
 * @param {string} options.path
 * @param {Record<string, string>} options.query - the request's own parameters
 * @param {string} options.service - as AWS names it in the scope, e.g. `transcribe`
 * @param {string} options.region
 * @param {{ accessKeyId: string, secretAccessKey: string, sessionToken?: string }} options.credentials
 * @param {number} options.expiresIn - seconds
 * @param {Date} [options.now]
 * @returns {Promise<string>}
 */
export async function presignUrl({ protocol, host, path, query, service, region, credentials, expiresIn, now = new Date() }) {
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${region}/${service}/aws4_request`;

  const params = {
    ...query,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${credentials.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
    ...(credentials.sessionToken && { 'X-Amz-Security-Token': credentials.sessionToken }),
  };
  const canonicalQuery = Object.entries(params)
    .map(([key, value]) => [encode(key), encode(value)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const canonicalRequest = ['GET', path, canonicalQuery, `host:${host}\n`, 'host', await sha256('')].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(canonicalRequest)].join('\n');

  let key = await hmac(`AWS4${credentials.secretAccessKey}`, date);
  for (const part of [region, service, 'aws4_request']) key = await hmac(key, part);
  const signature = hex(await hmac(key, stringToSign));

  return `${protocol}//${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
