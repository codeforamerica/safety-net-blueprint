/** Shared helpers for this spike's per-phase CLI scripts (ingest-project.js, graph-project.js, ...). */

/** Recursively convert Maps/Sets to plain objects/arrays so a value can be JSON-serialized and read back in a later phase's script. */
export function toJson(value) {
  if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [k, toJson(v)]));
  if (value instanceof Set) return [...value].map(toJson);
  if (Array.isArray(value)) return value.map(toJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJson(v)]));
  return value;
}

/**
 * Parse `<positional> [--out <file>]` style CLI args, shared across this spike's
 * phase scripts so each one doesn't reimplement the same `--out`/`--help` handling.
 */
export function parseCliArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    return null;
  }
  const outIndex = args.indexOf('--out');
  const hasOut = outIndex >= 0;
  const outFile = hasOut ? args[outIndex + 1] : undefined;
  const excluded = hasOut ? new Set([outIndex, outIndex + 1]) : new Set();
  const positional = args.filter((_, i) => !excluded.has(i))[0];
  return { positional, outFile };
}
