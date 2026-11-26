/**
 * Check the fields SLA type conditions and metric filters read against real
 * schemas, and that composition filters read their records as `item`.
 *
 * All three are CEL over one record, read through a variable as CEL's hosts
 * read a record (Kubernetes' `object`): a metric filter reads each record it
 * counts as `item`, as a `where:` reads its candidates (`item.status ==
 * "pending"`), and so does a composition filter, beside the section it
 * fills (`item.category == section.name`); an SLA condition reads the record its clock runs on as
 * `object`, as a guard does (`object.status in ["awaiting_client"]`). A field
 * the record doesn't have is missing, which CEL makes an error, so a
 * condition that has to allow for one tests it with `has()`:
 * `!has(item.assignedToId)`. A name read bare is refused, with the form to
 * write.
 *
 * Nothing stops a condition naming a field that does not exist — the
 * document is structurally valid and the condition simply never matches at
 * runtime, which is the worst way to find out. An expression that does not
 * parse is reported here too, for the same reason.
 *
 * Only the field a condition reads first is checked. `object.slaInfo.exists(x,
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

/** The SLA type conditions, each a CEL expression over the record as `object`. */
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
      errors.push(...checkExpression(slaType[key], properties, SLA_COLLECTION, `slaTypes[${slaType.id}].${key}`, 'object'));
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
      errors.push(...checkExpression(clause.filter, properties, clause.collection, `metrics[${metric.id}].${key}.filter`, 'item'));
    }
  }

  return errors;
}

/**
 * @param {import('../../types.js').Doc} doc - A compositions document
 * @returns {{ rule: string, message: string, path: string }[]}
 */
export function validateCompositionFilters(doc) {
  const errors = [];
  // Every filter: a node's, an include's, a section index's and a view's.
  const walk = (node, at) => {
    if (Array.isArray(node)) { node.forEach((item, i) => walk(item, `${at}[${i}]`)); return; }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'filter' && typeof value === 'string') {
        errors.push(...checkExpression(value, undefined, null, `${at}.filter`, 'item', ['section']));
      } else {
        walk(value, at ? `${at}.${key}` : key);
      }
    }
  };
  walk(doc.content?.compositions, 'compositions');
  return errors;
}

/**
 * Whether an expression parses, reads the record only through its variable,
 * and, when there is a schema to check against, reads only fields the
 * resource has.
 *
 * @param {string} expression
 * @param {Set<string>|undefined} properties - The resource's fields, when known
 * @param {string} collection
 * @param {string} path
 * @param {'item'|'object'} record - The variable the record is read through
 * @param {string[]} [others] - Other names the expression may read, such as a composition's `section`
 * @returns {{ rule: string, message: string, path: string }[]}
 */
function checkExpression(expression, properties, collection, path, record, others = []) {
  const syntax = celSyntaxError(expression);
  if (syntax) return [{ rule: 'cel-syntax', message: `"${expression}" is not CEL: ${syntax}`, path }];

  const { fields, bare } = namesRead(expression, record, others);
  const errors = [...bare].map((name) => ({
    rule: 'bare-field-reference',
    message: `"${expression}" reads "${name}" bare; the record is \`${record}\`. Write \`${record}.${name}\`, and \`has(${record}.${name})\` to test whether the record has it.`,
    path,
  }));
  if (!properties) return errors;

  return [...errors, ...[...fields]
    .filter((field) => !properties.has(field))
    .map((field) => ({
      rule: 'unknown-field-reference',
      message: `"${expression}" reads "${record}.${field}", and ${field} is not a field of the ${collection} resource.`,
      path,
    }))];
}

/**
 * What a CEL expression reads from outside itself: the fields it reads from
 * the record (`item.status` reads `status`), and any other name it reads
 * bare. The variables `exists`, `all` and `filter` bind for each item are
 * its own.
 *
 * @param {string} expression
 * @param {string} record - The record's variable
 * @param {string[]} others - Other names it may read
 * @returns {{ fields: Set<string>, bare: Set<string> }}
 */
function namesRead(expression, record, others) {
  const fields = new Set();
  const bare = new Set();
  const walk = (expr, bound) => {
    if (!expr) return;
    const { case: kind, value } = expr.exprKind;
    switch (kind) {
      case 'identExpr':
        if (!bound.has(value.name) && value.name !== record && !others.includes(value.name)) bare.add(value.name);
        break;
      case 'selectExpr':
        // record.field, or has(record.field)
        if (value.operand?.exprKind.case === 'identExpr' && value.operand.exprKind.value.name === record && !bound.has(record)) {
          fields.add(value.field);
          break;
        }
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
  return { fields, bare };
}
