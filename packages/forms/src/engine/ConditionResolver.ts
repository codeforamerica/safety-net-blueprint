import jsonLogic from 'json-logic-js';
import type { ShowWhen, SimpleCondition, JsonLogicCondition } from './types';

function isJsonLogicCondition(rule: ShowWhen): rule is JsonLogicCondition {
  return 'jsonlogic' in rule;
}

/**
 * Evaluates whether a field should be visible based on its show_when rule
 * and the current form values.
 *
 * Supports two formats:
 * - Simple: { field, equals/not_equals } for single-field checks
 * - JSON Logic: { jsonlogic: { ... } } for compound rules (AND, OR, comparisons, etc.)
 */
export function resolveCondition(
  rule: ShowWhen | undefined,
  formValues: Record<string, unknown>,
): boolean {
  if (!rule) return true;

  if (isJsonLogicCondition(rule)) {
    return Boolean(jsonLogic.apply(rule.jsonlogic, formValues));
  }

  return resolveSimpleCondition(rule, formValues);
}

function resolveSimpleCondition(
  rule: SimpleCondition,
  formValues: Record<string, unknown>,
): boolean {
  const value = getNestedValue(formValues, rule.field);

  if (rule.equals !== undefined) {
    return value === rule.equals;
  }

  if (rule.not_equals !== undefined) {
    return value !== rule.not_equals;
  }

  return true;
}

function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object') {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}
