/**
 * JSON Logic, which the behavioral contracts no longer take.
 *
 * A metric's filter, an SLA type's conditions, and the `where:` of a context
 * binding or a `forEach` step used to be JSON Logic. They are CEL now, as
 * every other condition is (cel.js), so a JSON Logic expression in one is
 * refused, with the CEL to write instead. A `where:` of field-value equality
 * pairs — `{ applicationId: $object.id }` — is not JSON Logic, and stays.
 */

/** The SLA type conditions, each a CEL expression over the resource's fields. */
const SLA_CONDITIONS = ['autoAssignWhen', 'startWhen', 'pauseWhen', 'resumeWhen', 'completedWhen', 'resetWhen'];

/** The parts of a metric that name a collection, each with its own filter. */
const METRIC_SOURCES = ['source', 'total', 'from', 'to'];

/**
 * JSON Logic's operators. A `where:` is JSON Logic when one of its keys is an
 * operator given its operands — an array or an object — where an equality
 * pair's value is a literal or a value expression.
 */
const OPERATORS = new Set([
  '==', '===', '!=', '!==', '>', '>=', '<', '<=', '!', '!!', 'and', 'or', 'not', 'in', 'if', 'var',
  'missing', 'missing_some', 'all', 'none', 'some', 'merge', 'cat', 'substr', 'log', 'map', 'filter', 'reduce',
]);

/** Names a `where:` condition reads without `item.`: everything but the candidate record. */
const SCOPE_NAMES = new Set(['caller', 'object', 'request', 'params', 'this', 'now']);

/** CEL's operators for JSON Logic's comparisons. */
const COMPARISONS = { '==': '==', '===': '==', '!=': '!=', '!==': '!=', '>': '>', '>=': '>=', '<': '<', '<=': '<=' };

/**
 * @param {import('../../types.js').Doc} doc - A metrics, sla-types or state-machine document
 * @returns {{ rule: string, message: string, path: string }[]}
 */
export function jsonLogicExpressions(doc) {
  const found = [];
  const content = doc.content ?? {};

  if (doc.type === 'metrics') {
    (content.metrics ?? []).forEach((metric, i) => {
      for (const key of METRIC_SOURCES) {
        const filter = metric?.[key]?.filter;
        if (isJsonLogic(filter)) found.push({ at: `/metrics/${i}/${key}/filter`, expression: filter, name: (path) => path });
      }
    });
  }

  if (doc.type === 'sla-types') {
    (content.slaTypes ?? []).forEach((slaType, i) => {
      for (const key of SLA_CONDITIONS) {
        if (isJsonLogic(slaType?.[key])) found.push({ at: `/slaTypes/${i}/${key}`, expression: slaType[key], name: (path) => path });
      }
    });
  }

  if (doc.type === 'state-machine') {
    // A binding's lookup and a forEach's are the same shape, wherever they
    // stand: a collection in `from:` and the records it wants in `where:`.
    const aliases = aliasesIn(content);
    const name = (path) => (aliases.has(path.split('.')[0]) ? path : `item.${path}`);
    const walk = (node, at) => {
      if (Array.isArray(node)) { node.forEach((item, i) => walk(item, `${at}/${i}`)); return; }
      if (!node || typeof node !== 'object') return;
      if (typeof node.from === 'string' && isWhereJsonLogic(node.where)) found.push({ at: `${at}/where`, expression: node.where, name });
      for (const [key, value] of Object.entries(node)) walk(value, `${at}/${key}`);
    };
    walk(content, '');
  }

  const errors = found.map(({ at, expression, name }) => {
    const translation = { substring: false };
    const cel = toCel(expression, name, translation);
    const where = at.endsWith('/where') ? ' In a where:, `item` is the candidate record.' : '';
    const contains = translation.substring ? ' Where `in` tests a string for a substring, write `text.contains(part)`.' : '';
    return {
      rule: 'json-logic-expression',
      message: `${at} is JSON Logic, which the behavioral contracts no longer take; conditions are CEL. ` +
        (cel ? `Write \`${cel}\`.${where}${contains}` : `Write it as a CEL string.${where}`),
      path: `${doc.path}#${at}`,
    };
  });

  // A procedure's `conditions:` list of JSON Logic conditions, each with
  // `then:` steps, is no longer run; `if:` steps take its place.
  if (doc.type === 'state-machine') {
    const walk = (node, at) => {
      if (Array.isArray(node)) { node.forEach((item, i) => walk(item, `${at}/${i}`)); return; }
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node.procedures)) {
        node.procedures.forEach((procedure, i) => {
          if (Array.isArray(procedure?.conditions)) {
            errors.push({
              rule: 'procedure-conditions',
              message: `${at}/procedures/${i}/conditions is not run; a procedure's steps are. ` +
                'Write each condition as an `if:` step with a CEL condition and its steps under `then:`.',
              path: `${doc.path}#${at}/procedures/${i}/conditions`,
            });
          }
        });
      }
      for (const [key, value] of Object.entries(node)) walk(value, `${at}/${key}`);
    };
    walk(content, '');
  }

  return errors;
}

/** Whether a metric filter or SLA condition is JSON Logic: anything but the CEL string it takes. */
function isJsonLogic(expression) {
  return expression !== undefined && expression !== null && typeof expression === 'object';
}

/** Whether a `where:` is JSON Logic rather than field-value equality pairs. */
function isWhereJsonLogic(where) {
  if (!where || typeof where !== 'object' || Array.isArray(where)) return false;
  return Object.entries(where).some(([key, value]) => OPERATORS.has(key) && value !== null && typeof value === 'object');
}

/**
 * The names a state machine document gives records: each context binding's
 * alias and each forEach's `as`, plus the names every condition has.
 *
 * @param {object} content
 * @returns {Set<string>}
 */
function aliasesIn(content) {
  const names = new Set(SCOPE_NAMES);
  const walk = (node, key) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        // context: [{ alias: { from, where } }]
        if (key === 'context' && item && typeof item === 'object') for (const alias of Object.keys(item)) names.add(alias);
        walk(item);
      }
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (typeof node.forEach?.as === 'string') names.add(node.forEach.as);
    for (const [k, value] of Object.entries(node)) walk(value, k);
  };
  walk(content);
  return names;
}

/**
 * A JSON Logic expression as CEL, or null when it uses an operator with no
 * plain counterpart.
 *
 *   { "==": [{ var: "type" }, "workflow.task.created"] }  → type == "workflow.task.created"
 *   { in: [{ var: "status" }, ["a", "b"]] }                → status in ["a", "b"]
 *   { some: [{ var: "slaInfo" }, { "==": [{ var: "status" }, "breached"] }] }
 *                                                          → slaInfo.exists(x, x.status == "breached")
 *
 * @param {*} node
 * @param {(path: string) => string} name - The CEL for a `var` path
 * @param {{ substring: boolean }} translation - Set when an `in` may test a string
 * @param {number} [depth] - How many `some`, `all` and `none` enclose it
 * @returns {string|null}
 */
function toCel(node, name, translation, depth = 0) {
  if (node === null) return 'null';
  if (typeof node === 'string') return JSON.stringify(node);
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) {
    const items = node.map((item) => toCel(item, name, translation, depth));
    return items.includes(null) ? null : `[${items.join(', ')}]`;
  }
  if (typeof node !== 'object') return null;

  const keys = Object.keys(node);
  if (keys.length !== 1) return null;
  const [op] = keys;
  const args = Array.isArray(node[op]) ? node[op] : [node[op]];
  const operand = (arg) => {
    const cel = toCel(arg, name, translation, depth);
    // Grouped where CEL would bind it differently.
    return cel !== null && arg && typeof arg === 'object' && !Array.isArray(arg) && ['and', 'or', 'if'].includes(Object.keys(arg)[0]) ? `(${cel})` : cel;
  };
  const all = (list) => {
    const out = list.map(operand);
    return out.includes(null) ? null : out;
  };

  if (op === 'var') return typeof args[0] === 'string' ? name(args[0]) : null;
  if (Object.hasOwn(COMPARISONS, op) && args.length === 2) {
    const [a, b] = all(args) ?? [];
    return a === undefined ? null : `${a} ${COMPARISONS[op]} ${b}`;
  }
  if (op === 'and' || op === 'or') {
    const parts = all(args);
    return parts && parts.join(op === 'and' ? ' && ' : ' || ');
  }
  if ((op === '!' || op === 'not') && args.length === 1) {
    const inner = operand(args[0]);
    return inner === null ? null : (/^[\w.]+$/.test(inner) ? `!${inner}` : `!(${inner})`);
  }
  if (op === 'in' && args.length === 2) {
    const [a, b] = all(args) ?? [];
    if (a === undefined) return null;
    if (!Array.isArray(args[1])) translation.substring = true;
    return `${a} in ${b}`;
  }
  if (op === 'if' && args.length === 3) {
    const parts = all(args);
    return parts && `${parts[0]} ? ${parts[1]} : ${parts[2]}`;
  }
  if (['some', 'all', 'none'].includes(op) && args.length === 2) {
    const list = operand(args[0]);
    // Inside, a var names a field of each item, and "" the item itself.
    const item = ['x', 'y', 'z'][depth] ?? `x${depth}`;
    const condition = toCel(args[1], (path) => (path === '' ? item : `${item}.${path}`), translation, depth + 1);
    if (list === null || condition === null) return null;
    if (op === 'some') return `${list}.exists(${item}, ${condition})`;
    if (op === 'all') return `${list}.all(${item}, ${condition})`;
    return `!${list}.exists(${item}, ${condition})`;
  }
  return null;
}
