/**
 * AWS's event stream framing, which Amazon Transcribe's streaming WebSocket
 * speaks in both directions: a binary message with a prelude, headers, a
 * payload and two CRC32 checksums. Written to AWS's published format rather
 * than taken from the AWS SDK; its tests check it against AWS's own codec.
 * https://docs.aws.amazon.com/transcribe/latest/dg/streaming-setting-up.html
 *
 *   total length (4) | headers length (4) | prelude CRC (4)
 *   headers | payload | message CRC (4)
 *
 * A header is its name's length (1), the name, a type (1) and its value;
 * only strings (type 7: a 2-byte length, then UTF-8) are used here.
 */

const STRING = 7;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC32 (IEEE 802.3), as the format uses. */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * @param {Record<string, string>} headers
 * @param {Uint8Array} payload
 * @returns {Uint8Array}
 */
export function encodeMessage(headers, payload) {
  const parts = [];
  for (const [name, value] of Object.entries(headers)) {
    const n = encoder.encode(name);
    const v = encoder.encode(value);
    const header = new Uint8Array(1 + n.length + 1 + 2 + v.length);
    const view = new DataView(header.buffer);
    header[0] = n.length;
    header.set(n, 1);
    header[1 + n.length] = STRING;
    view.setUint16(2 + n.length, v.length);
    header.set(v, 4 + n.length);
    parts.push(header);
  }
  const headersLength = parts.reduce((sum, part) => sum + part.length, 0);
  const total = 12 + headersLength + payload.length + 4;
  const message = new Uint8Array(total);
  const view = new DataView(message.buffer);
  view.setUint32(0, total);
  view.setUint32(4, headersLength);
  view.setUint32(8, crc32(message.subarray(0, 8)));
  let offset = 12;
  for (const part of parts) { message.set(part, offset); offset += part.length; }
  message.set(payload, offset);
  view.setUint32(total - 4, crc32(message.subarray(0, total - 4)));
  return message;
}

/**
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {{ headers: Record<string, string>, payload: Uint8Array }}
 */
export function decodeMessage(data) {
  const message = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  const total = view.getUint32(0);
  const headersLength = view.getUint32(4);
  if (total !== message.length) throw new Error(`An event stream message says it's ${total} bytes and is ${message.length}`);
  if (view.getUint32(8) !== crc32(message.subarray(0, 8))) throw new Error('An event stream message\'s prelude checksum is wrong');
  if (view.getUint32(total - 4) !== crc32(message.subarray(0, total - 4))) throw new Error('An event stream message\'s checksum is wrong');

  const headers = {};
  let offset = 12;
  const end = 12 + headersLength;
  while (offset < end) {
    const nameLength = message[offset];
    const name = decoder.decode(message.subarray(offset + 1, offset + 1 + nameLength));
    offset += 1 + nameLength;
    const type = message[offset];
    if (type !== STRING) throw new Error(`An event stream header "${name}" has type ${type}; only strings are read`);
    const valueLength = view.getUint16(offset + 1);
    headers[name] = decoder.decode(message.subarray(offset + 3, offset + 3 + valueLength));
    offset += 3 + valueLength;
  }
  return { headers, payload: message.subarray(end, total - 4) };
}
