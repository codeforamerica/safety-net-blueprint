/**
 * Relative-time token resolver for seed data, stub responses and state
 * machine values.
 *
 * Grammar:
 *   $now                    → reference instant T (ISO 8601 UTC)
 *   $now-P30D               → T − 30 days
 *   $now+P2D                → T + 2 days
 *   $now+PT8H               → T + 8 hours
 *   $now+P1M                → T + 1 calendar month (PT1M is 1 minute)
 *   $now+P2D@09:30          → T + 2 days, local time pinned to 09:30
 *   $now@17:00              → today, local time pinned to 17:00
 *
 * The offset is an ISO 8601 duration with a sign, as a timer's fireOffset is.
 * Years and months are calendar arithmetic: a day past the end of the month
 * lands on its last day, so January 31 + P1M is the end of February. Weeks,
 * days, hours, minutes and seconds are fixed lengths. The @HH:MM pin is the
 * DSL's own; it uses setHours(), in local server time.
 *
 * The old offsets — $now+2d, $now-8h, $now+30m, $now+1w — still resolve, with
 * a warning naming the ISO form, and will be removed in a later release.
 *
 * Unrecognised $now... expressions (e.g. $now+7dasys) throw — fail loudly
 * rather than silently writing raw tokens into the database.
 */

const ISO_RE = /^\$now(?:([+-])P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)?(?:@(\d{1,2}):(\d{2}))?$/;
const OLD_RE = /^\$now([+-])(\d+)([dhwm])(?:@(\d{1,2}):(\d{2}))?$/;
const OLD_AS_ISO = { d: (n) => `P${n}D`, w: (n) => `P${n}W`, h: (n) => `PT${n}H`, m: (n) => `PT${n}M` };
const warned = new Set();

/**
 * Whether a string is a $now token this resolver reads, in either form.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isTimeToken(value) {
  return typeof value === 'string' && (isIso(value) || OLD_RE.test(value));
}

function isIso(value) {
  const match = ISO_RE.exec(value);
  if (!match) return false;
  // A duration names at least one amount, and a T at least one time amount.
  const sign = match[1];
  if (!sign) return true;
  const [years, months, weeks, days, hours, minutes, seconds] = match.slice(2, 9);
  const any = [years, months, weeks, days, hours, minutes, seconds].some((n) => n !== undefined);
  const hasT = /P[^@]*T/.test(value);
  return any && (!hasT || [hours, minutes, seconds].some((n) => n !== undefined));
}

/**
 * The date `months` calendar months from `date`, kept to the last day of the
 * month it lands in.
 */
function addMonths(date, months) {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

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

  const old = OLD_RE.exec(value);
  if (old) {
    const [, sign, amount, unit, hh, mm] = old;
    const iso = `$now${sign}${OLD_AS_ISO[unit](amount)}${hh !== undefined ? `@${hh}:${mm}` : ''}`;
    if (!warned.has(value)) {
      warned.add(value);
      console.warn(`Time token "${value}" is deprecated: write "${iso}". The old form will be removed in a later release.`);
    }
    return resolveTimeToken(iso, now);
  }

  if (!isIso(value)) {
    throw new Error(`Invalid time token: "${value}". Expected $now, an optional signed ISO 8601 duration ($now+P2D, $now-PT30M), and an optional @HH:MM`);
  }

  const [, sign, years, months, weeks, days, hours, minutes, seconds, hh, mm] = ISO_RE.exec(value);
  let date = new Date(now);

  if (sign) {
    const direction = sign === '+' ? 1 : -1;
    const n = (part) => (part === undefined ? 0 : parseInt(part, 10));
    const calendarMonths = n(years) * 12 + n(months);
    if (calendarMonths) date = addMonths(date, direction * calendarMonths);
    const ms = ((n(weeks) * 7 + n(days)) * 86400 + n(hours) * 3600 + n(minutes) * 60 + n(seconds)) * 1000;
    date = new Date(date.getTime() + direction * ms);
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
