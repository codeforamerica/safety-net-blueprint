/**
 * Check the fields SLA type conditions and metric filters read against real
 * schemas.
 *
 * Both are CEL over a record's fields, named as they are: `status in
 * ["awaiting_client"]` reads the field `status`. Nothing stops one naming a
 * field that does not exist — the document is structurally valid and the
 * condition simply never matches at runtime, which is the worst way to find
 * out. An expression that does not parse is reported here too, for the same
 * reason.
 *
 * Only the names an expression starts from are checked. `slaInfo.exists(x,
 * x.status == "breached")` is verified as far as `slaInfo` existing on the
 * resource; the nested shape is the schema's business, and resolving it
 * through composed and referenced schemas would report confident nonsense more
 * often than it would catch a real mistake.
 *
 * A JSON Logic expression, which these used to be, is refused by
 * json-logic-validator.js and skipped here.
 */

import { parse } from '@bufbuild/cel';
import { celSyntaxError } from '../cel.js';

/**
 * SLA types do not name the collection they apply to — they are a workflow
 * concept and always describe Task lifecycle.
 */
const SLA_COLLECTION = 'tasks';

/** The SLA type conditions, each a CEL expression over the resource's fields. */
const SLA_CONDITIONS = ['autoAssignWhen', 'startWhen', 'pauseWhen', 'resumeWhen', 'completedWhen', 'resetWhen'];

/**
 * Collections are looked up within the document's own domain. A bare name is
 * ambiguous across domains, and resolving it to the wrong one checks fields
 * against an unrelated schema and reports confident nonsense.
 *
 * @param {import('../../types.js').Doc} doc
 * @param {string} collection
 * @returns {string}
 */
function qualify(doc, collection) {
  return `${doc.content?.domain}/${collection}`;
}

/**
 * @param {import('../../types.js').Doc} doc - An sla-types document
 * @param {Map<string, Set<string>>} propertiesByCollection
 * @returns {{ rule: string, message: string, path: string }[]}
 */
export function validateSlaTypeFields(doc, propertiesByCollection) {
  const properties = propertiesByCollection.get(qualify(doc, SLA_COLLECTION));
  const errors = [];

  for (const slaType of doc.content?.slaTypes ?? []) {
    for (const key of SLA_CONDITIONS) {
      if (typeof slaType?.[key] !== 'string') continue;
      errors.push(...checkExpression(slaType[key], properties, SLA_COLLECTION, `slaTypes[${slaType.id}].${key}`));
    }
  }

  return errors;
}

/**
 * @param {import('../../types.js').Doc} doc - A metrics document
 * @param {Map<string, Set<string>>} propertiesByCollection
 * @returns {{ rule: string, message: string, path: string }[]}
 */
export function validateMetricFields(doc, propertiesByCollection) {
  const errors = [];

  for (const metric of doc.content?.metrics ?? []) {
    // A metric can draw from up to four collections, each with its own filter.
    for (const key of ['source', 'total', 'from', 'to']) {
      const clause = metric[key];
      if (typeof clause?.filter !== 'string') continue;

      // A collection the domain does not expose as an OpenAPI resource has no
      // schema to check against — a metric over the runtime event stream, say.
      const properties = propertiesByCollection.get(qualify(doc, clause.collection));
      errors.push(...checkExpression(clause.filter, properties, clause.collection, `metrics[${metric.id}].${key}.filter`));
    }
  }

  return errors;
}

/**
 * Whether an expression parses, and when there is a schema to check against,
 * whether every field it reads is one the resource has.
 *
 * @param {string} expression
 * @param {Set<string>|undefined} properties - The resource's fields, when known
 * @param {string} collection
 * @param {string} path
 * @returns {{ rule: string, message: string, path: string }[]}
 */
function checkExpression(expression, properties, collection, path) {
  const syntax = celSyntaxError(expression);
  if (syntax) return [{ rule: 'cel-syntax', message: `"${expression}" is not CEL: ${syntax}`, path }];
  if (!properties) return [];

  return [...namesRead(expression)]
    .filter((field) => !properties.has(field))
    .map((field) => ({
      rule: 'unknown-field-reference',
      message: `"${expression}" reads "${field}", which is not a field of the ${collection} resource.`,
      path,
    }));
}

/**
 * The names a CEL expression reads from outside itself: every identifier but
 * the variables `exists`, `all` and `filter` bind for each item.
 *
 * @param {string} expression
 * @returns {Set<string>}
 */
function namesRead(expression) {
  const names = new Set();
  const walk = (expr, bound) => {
    if (!expr) return;
    const { case: kind, value } = expr.exprKind;
    switch (kind) {
      case 'identExpr':
        if (!bound.has(value.name)) names.add(value.name);
        break;
      case 'selectExpr':
        walk(value.operand, bound);
        break;
      case 'callExpr':
        walk(value.target, bound);
        for (const arg of value.args) walk(arg, bound);
        break;
      case 'listExpr':
        for (const element of value.elements) walk(element, bound);
        break;
      case 'structExpr':
        for (const entry of value.entries) {
          if (entry.keyKind.case === 'mapKey') walk(entry.keyKind.value, bound);
          walk(entry.value, bound);
        }
        break;
      case 'comprehensionExpr': {
        walk(value.iterRange, bound);
        walk(value.accuInit, bound);
        const inside = new Set([...bound, value.iterVar, value.accuVar]);
        walk(value.loopCondition, inside);
        walk(value.loopStep, inside);
        walk(value.result, inside);
        break;
      }
      default:
        break;
    }
  };
  walk(parse(expression).expr, new Set());
  return names;
}
