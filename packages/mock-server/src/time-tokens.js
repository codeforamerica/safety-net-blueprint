/**
 * Relative-time token resolver for seed data and stub responses.
 *
 * Grammar:
 *   $now                    → reference instant T (ISO 8601 UTC)
 *   $now-30d                → T − 30 days
 *   $now+2d                 → T + 2 days
 *   $now+8h                 → T + 8 hours
 *   $now+2d@09:30           → T + 2 days, local time pinned to 09:30
 *   $now@17:00              → today, local time pinned to 17:00
 *
 * Units: d (days), h (hours), m (minutes), w (weeks). Integer amounts only.
 * The @HH:MM pin uses setHours() which operates in local server time.
 *
 * Unrecognised $now... expressions (e.g. $now+7dasys) throw — fail loudly
 * rather than silently writing raw tokens into the database.
 */

const UNIT_MS = { d: 86400000, h: 3600000, m: 60000, w: 604800000 };
const TOKEN_RE = /^\$now([+-]\d+[dhwm])?(?:@(\d{1,2}):(\d{2}))?$/;

/**
 * Resolve a single $now token string against a reference instant.
 * Returns the original value unchanged if it is not a $now token.
 * Throws if the string looks like a $now token but is malformed.
 *
 * @param {*} value - Value to test
 * @param {Date} [now] - Reference instant (defaults to current time)
 * @returns {*} Resolved ISO 8601 string, or original value
 */
export function resolveTimeToken(value, now = new Date()) {
  if (typeof value !== 'string') return value;
  if (value !== '$now' && !value.startsWith('$now+') && !value.startsWith('$now-') && !value.startsWith('$now@')) {
    return value;
  }

  const match = TOKEN_RE.exec(value);
  if (!match) {
    throw new Error(`Invalid time token: "${value}". Expected $now[±N{d|h|m|w}][@HH:MM]`);
  }

  const [, offset, hh, mm] = match;
  let date = new Date(now);

  if (offset) {
    const sign = offset[0] === '+' ? 1 : -1;
    const amount = parseInt(offset.slice(1, -1), 10);
    const ms = UNIT_MS[offset.slice(-1)];
    date = new Date(date.getTime() + sign * amount * ms);
  }

  if (hh !== undefined) {
    date.setHours(parseInt(hh, 10), parseInt(mm, 10), 0, 0);
  }

  return date.toISOString();
}

/**
 * Recursively walk an object/array and resolve all $now token strings.
 * Non-string values and non-$now strings are returned unchanged.
 * All tokens see the same reference instant, keeping relative timestamps
 * internally consistent within a single walk.
 *
 * @param {*} obj - Object, array, or scalar to walk
 * @param {Date} [now] - Reference instant (pinned across the whole walk)
 * @returns {*} Deep copy with all time tokens resolved
 */
export function resolveTimeTokens(obj, now = new Date()) {
  if (typeof obj === 'string') return resolveTimeToken(obj, now);
  if (Array.isArray(obj)) return obj.map(item => resolveTimeTokens(item, now));
  if (obj !== null && typeof obj === 'object') {
    const result = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = resolveTimeTokens(val, now);
    }
    return result;
  }
  return obj;
}
