/**
 * Unit tests for cel-evaluator's context binding.
 *
 * The evaluator compiles an expression with `new Function`, binding each
 * context key as a parameter name. Some callers build that context by
 * spreading a stored record — composition filters do — so a record saved with
 * a crafted property name could close the parameter list and append code.
 *
 * bindableContext is what stops that, and these tests are the reason it can't
 * be quietly removed.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { evaluateCEL, bindableContext } from '../../src/cel-evaluator.js';

describe('bindableContext', () => {
  test('keeps plain identifiers, including $-prefixed ones', () => {
    const { names } = bindableContext({ status: 1, $this: 2, _x: 3, a1: 4 });
    assert.deepStrictEqual(names.sort(), ['$this', '_x', 'a1', 'status']);
  });

  test('drops anything that is not an identifier', () => {
    const { names } = bindableContext({
      'x); return 1; (': 1,
      'has-dash': 2,
      'has space': 3,
      '1leading': 4,
      '': 5,
      ok: 6,
    });
    assert.deepStrictEqual(names, ['ok']);
  });

  test('values stay aligned with the names kept', () => {
    const { names, values } = bindableContext({ 'bad key': 'dropped', a: 1, b: 2 });
    assert.deepStrictEqual(names, ['a', 'b']);
    assert.deepStrictEqual(values, [1, 2]);
  });
});

describe('evaluateCEL — context is not an injection point', () => {
  test('a crafted property name cannot execute', () => {
    const record = { status: 'active' };
    record['x); globalThis.__CEL_INJECTED__ = true; ('] = 1;

    const result = evaluateCEL('status == "active"', record);

    assert.strictEqual(result, true, 'the legitimate field still resolves');
    assert.strictEqual(
      globalThis.__CEL_INJECTED__,
      undefined,
      'the crafted key must never reach the generated function'
    );
  });

  test('an expression referring only to a dropped key fails closed', () => {
    const record = {};
    record['bad key'] = 'value';

    // The name is not bound, so the expression cannot resolve. Undefined is
    // the evaluator's failure result — it must not throw or evaluate.
    assert.strictEqual(evaluateCEL('badkey == "value"', record), undefined);
  });

  test('ordinary evaluation is unaffected', () => {
    assert.strictEqual(evaluateCEL('$this.age >= 18', { $this: { age: 22 } }), true);
    assert.strictEqual(evaluateCEL('items.size() > 1', { items: [1, 2] }), true);
  });
});
