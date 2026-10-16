/**
 * Unit tests for the blueprint's CEL: standard CEL plus the functions it adds.
 *
 * `sum()` is defined as Kubernetes' CEL list library defines it, so these pin
 * that behavior: one numeric type per list, the same type back, 0 for an
 * empty list, and an error rather than a promotion when types mix.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@bufbuild/cel';
import { evaluateCEL } from '../../src/cel.js';

describe('sum()', () => {
  test('totals a list of doubles', () => {
    assert.equal(evaluateCEL('[1000.0, 1000.0].sum()'), 2000);
  });

  test('totals a list of ints, as an int', () => {
    // An int result stays exact and works in int arithmetic.
    assert.equal(evaluateCEL('[1, 2, 3].sum() / 2'), 3);
  });

  test('totals a list of uints', () => {
    assert.equal(evaluateCEL('[1u, 2u].sum()'), 3);
  });

  test('an empty list sums to 0', () => {
    assert.equal(evaluateCEL('[].sum()'), 0);
    assert.equal(evaluateCEL('[].sum() < 2000.0'), true, 'and compares with a double');
  });

  test('totals what an expression selects from the data', () => {
    // The case it was added for: a member's earned income across jobs.
    const incomes = [
      { memberId: 'a', amount: 1000 },
      { memberId: 'a', amount: 1000 },
      { memberId: 'b', amount: 5 },
    ];
    assert.equal(evaluateCEL('incomes.filter(i, i.memberId == "a").map(i, i.amount).sum()', { incomes }), 2000);
  });

  test('a list mixing numeric types is an error, not a promotion', () => {
    assert.throws(() => evaluateCEL('[1, 2.0].sum()'), /one numeric type; found int and double/);
  });

  test('a list of anything but numbers is an error', () => {
    assert.throws(() => evaluateCEL('["a"].sum()'), /list of numbers/);
  });

  test('is available to a parsed expression too', () => {
    // The rules engine evaluates parsed pieces of an expression, not text.
    assert.equal(evaluateCEL(parse('[2.5, 2.5].sum()')), 5);
  });
});
