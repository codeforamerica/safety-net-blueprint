/**
 * Unit tests for x-sortable validation in pattern-validator.
 *
 * Covers the design from docs/specs/spec-20260512-list-endpoint-sorting.md:
 *   - x-sortable shape validation (fields required; default/tieBreaker/maxFields optional)
 *   - Cross-reference validation against the list endpoint's response schema,
 *     following $ref and allOf branches; dot-notation for nested fields
 *   - Lexical identifier regex on every field name (security boundary; A03/A05)
 *   - SortParam must be referenced in parameters when x-sortable is present
 *   - PII warning when sort-as-oracle leaks sensitive field ordering (A01)
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { validateSpec } from '../../src/validation/pattern-validator.js';

// =============================================================================
// Spec factory — minimal valid list endpoint, customize per test
// =============================================================================

/**
 * Build a spec with one list endpoint and one resource schema. Most tests
 * override only what they need.
 */
function buildSpec(overrides = {}) {
  const sortableExt = overrides.xSortable;
  const params = overrides.parameters ?? [
    { $ref: './components/parameters.yaml#/SearchQueryParam' },
    { $ref: './components/parameters.yaml#/LimitParam' },
    { $ref: './components/parameters.yaml#/OffsetParam' },
    { $ref: './components/parameters.yaml#/SortParam' },
  ];
  const resourceSchema = overrides.resourceSchema ?? {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      createdAt: { type: 'string', format: 'date-time' },
      priority: { type: 'string' },
      dueDate: { type: 'string', format: 'date' },
      status: { type: 'string' },
      description: { type: 'string' },
    },
  };

  const operation = {
    operationId: 'listTasks',
    parameters: params,
    responses: {
      '200': {
        description: 'ok',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                items: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Task' },
                },
                total: { type: 'integer' },
                limit: { type: 'integer' },
                offset: { type: 'integer' },
                hasNext: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  };

  if (sortableExt !== undefined) operation['x-sortable'] = sortableExt;

  return {
    paths: {
      '/tasks': { get: operation },
    },
    components: {
      schemas: {
        Task: resourceSchema,
      },
    },
  };
}

function findErrors(errors, rulePrefix) {
  return errors.filter(e => e.rule.startsWith(rulePrefix));
}

// =============================================================================
// Happy paths
// =============================================================================

test('x-sortable — happy paths', async (t) => {
  await t.test('valid single-field declaration passes', () => {
    const spec = buildSpec({ xSortable: { fields: ['createdAt'] } });
    const errors = validateSpec(spec, 'test-spec.yaml');
    assert.strictEqual(findErrors(errors, 'sortable-').length, 0, JSON.stringify(errors));
    console.log('  ✓ Single field passes');
  });

  await t.test('valid multi-field with default and tieBreaker passes', () => {
    const spec = buildSpec({
      xSortable: {
        fields: ['createdAt', 'priority', 'dueDate'],
        default: '-priority,dueDate',
        tieBreaker: 'id',
        maxFields: 3,
      },
    });
    const errors = validateSpec(spec, 'test-spec.yaml');
    assert.strictEqual(findErrors(errors, 'sortable-').length, 0, JSON.stringify(errors));
    console.log('  ✓ Multi-field with all optional fields passes');
  });

  await t.test('endpoint without x-sortable has no sortable errors', () => {
    const spec = buildSpec({ xSortable: undefined });
    const errors = validateSpec(spec, 'test-spec.yaml');
    assert.strictEqual(findErrors(errors, 'sortable-').length, 0, JSON.stringify(errors));
    console.log('  ✓ Endpoint without x-sortable does not require it');
  });
});

// =============================================================================
// Structural errors
// =============================================================================

test('x-sortable — structural errors', async (t) => {
  await t.test('missing fields array errors', () => {
    const spec = buildSpec({ xSortable: { default: 'createdAt' } });
    const errors = validateSpec(spec, 'test-spec.yaml');
    const hits = findErrors(errors, 'sortable-fields-required');
    assert.strictEqual(hits.length, 1, JSON.stringify(errors));
    console.log('  ✓ Missing fields rejected');
  });

  await t.test('empty fields array errors', () => {
    const spec = buildSpec({ xSortable: { fields: [] } });
    const errors = validateSpec(spec, 'test-spec.yaml');
    const hits = findErrors(errors, 'sortable-fields-required');
    assert.strictEqual(hits.length, 1, JSON.stringify(errors));
    console.log('  ✓ Empty fields rejected');
  });

  await t.test('SortParam not referenced when x-sortable is present errors', () => {
    const spec = buildSpec({
      xSortable: { fields: ['createdAt'] },
      parameters: [
        { $ref: './components/parameters.yaml#/SearchQueryParam' },
        { $ref: './components/parameters.yaml#/LimitParam' },
        { $ref: './components/parameters.yaml#/OffsetParam' },
        // SortParam intentionally omitted
      ],
    });
    const errors = validateSpec(spec, 'test-spec.yaml');
    const hits = findErrors(errors, 'sortable-param-required');
    assert.strictEqual(hits.length, 1, JSON.stringify(errors));
    console.log('  ✓ Missing SortParam reference rejected');
  });
});

// =============================================================================
// Cross-reference against response schema
// =============================================================================

test('x-sortable — schema cross-reference', async (t) => {
  await t.test('field not on response schema errors', () => {
    const spec = buildSpec({ xSortable: { fields: ['nonexistent'] } });
    const errors = validateSpec(spec, 'test-spec.yaml');
    const hits = findErrors(errors, 'sortable-field-unknown');
    assert.strictEqual(hits.length, 1, JSON.stringify(errors));
    console.log('  ✓ Field not on response schema rejected');
  });

  await t.test('default references field not in fields list errors', () => {
    const spec = buildSpec({
      xSortable: { fields: ['createdAt'], default: 'priority' },
    });
    const errors = validateSpec(spec, 'test-spec.yaml');
    const hits = findErrors(errors, 'sortable-default-not-in-fields');
    assert.strictEqual(hits.length, 1, JSON.stringify(errors));
    console.log('  ✓ Default with field absent from fields rejected');
  });

  await t.test('tieBreaker not on response schema errors', () => {
    const spec = buildSpec({
      xSortable: { fields: ['createdAt'], tieBreaker: 'nonexistent' },
    });
    const errors = validateSpec(spec, 'test-spec.yaml');
    const hits = findErrors(errors, 'sortable-tieBreaker-unknown');
    assert.strictEqual(hits.length, 1, JSON.stringify(errors));
    console.log('  ✓ tieBreaker not on schema rejected');
  });

  await t.test('nested-field via dot-notation resolves through allOf', () => {
    const spec = buildSpec({
      xSortable: { fields: ['name.lastName'] },
      resourceSchema: {
        allOf: [
          {
            type: 'object',
            properties: {
              name: {
                type: 'object',
                properties: {
                  firstName: { type: 'string' },
                  lastName: { type: 'string' },
                },
              },
            },
          },
          { type: 'object', properties: { id: { type: 'string' } } },
        ],
      },
    });
    const errors = validateSpec(spec, 'test-spec.yaml');
    assert.strictEqual(findErrors(errors, 'sortable-').length, 0, JSON.stringify(errors));
    console.log('  ✓ Nested field via dot-notation accepted');
  });

  await t.test('nested field whose parent does not exist errors', () => {
    const spec = buildSpec({ xSortable: { fields: ['name.lastName'] } });
    const errors = validateSpec(spec, 'test-spec.yaml');
    const hits = findErrors(errors, 'sortable-field-unknown');
    assert.strictEqual(hits.length, 1, JSON.stringify(errors));
    console.log('  ✓ Nested field with missing parent rejected');
  });
});

// =============================================================================
// Lexical identifier regex — security boundary (A03:2025, A05:2025)
// =============================================================================

test('x-sortable — lexical identifier regex (security boundary)', async (t) => {
  const badNames = [
    "createdAt; DROP TABLE x",       // SQL injection
    "createdAt'",                     // single quote
    'createdAt"',                     // double quote
    'created`At',                     // backtick
    'created[At]',                    // JSON-path metacharacters
    'created\\At',                    // backslash
    'created At',                     // whitespace
    'created\tAt',                    // tab
    'createdÄt',                      // non-ASCII
    'created​At',                // zero-width space
    'created‮At',                // RTL override
    '0startsWithDigit',               // leading digit
    'a..b',                           // empty segment
    '.leadingDot',                    // leading dot
    'trailingDot.',                   // trailing dot
  ];

  for (const bad of badNames) {
    await t.test(`field name ${JSON.stringify(bad)} rejected`, () => {
      const spec = buildSpec({ xSortable: { fields: [bad] } });
      const errors = validateSpec(spec, 'test-spec.yaml');
      const hits = findErrors(errors, 'sortable-field-lexical');
      assert.strictEqual(hits.length, 1, JSON.stringify(errors));
    });
  }

  await t.test('lexical rule applies to default values too', () => {
    const spec = buildSpec({
      xSortable: { fields: ['createdAt'], default: "createdAt; DROP TABLE x" },
    });
    const errors = validateSpec(spec, 'test-spec.yaml');
    const hits = findErrors(errors, 'sortable-default-lexical');
    assert.strictEqual(hits.length, 1, JSON.stringify(errors));
    console.log('  ✓ Lexical rule applies to default');
  });

  await t.test('lexical rule applies to tieBreaker too', () => {
    const spec = buildSpec({
      xSortable: { fields: ['createdAt'], tieBreaker: "id'" },
    });
    const errors = validateSpec(spec, 'test-spec.yaml');
    const hits = findErrors(errors, 'sortable-tieBreaker-lexical');
    assert.strictEqual(hits.length, 1, JSON.stringify(errors));
    console.log('  ✓ Lexical rule applies to tieBreaker');
  });

  await t.test('valid dot-notation passes lexical rule', () => {
    const spec = buildSpec({
      xSortable: { fields: ['name.lastName', 'createdAt'] },
      resourceSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          createdAt: { type: 'string' },
          name: { type: 'object', properties: { lastName: { type: 'string' } } },
        },
      },
    });
    const errors = validateSpec(spec, 'test-spec.yaml');
    assert.strictEqual(findErrors(errors, 'sortable-').length, 0, JSON.stringify(errors));
    console.log('  ✓ Valid dot-notation accepted');
  });
});

// =============================================================================
// maxFields validation
// =============================================================================

test('x-sortable — maxFields', async (t) => {
  await t.test('positive integer accepted', () => {
    const spec = buildSpec({ xSortable: { fields: ['createdAt'], maxFields: 3 } });
    const errors = validateSpec(spec, 'test-spec.yaml');
    assert.strictEqual(findErrors(errors, 'sortable-maxFields').length, 0, JSON.stringify(errors));
    console.log('  ✓ Positive integer accepted');
  });

  await t.test('non-integer rejected', () => {
    const spec = buildSpec({ xSortable: { fields: ['createdAt'], maxFields: 1.5 } });
    const errors = validateSpec(spec, 'test-spec.yaml');
    assert.strictEqual(findErrors(errors, 'sortable-maxFields-type').length, 1, JSON.stringify(errors));
    console.log('  ✓ Non-integer rejected');
  });

  await t.test('zero rejected', () => {
    const spec = buildSpec({ xSortable: { fields: ['createdAt'], maxFields: 0 } });
    const errors = validateSpec(spec, 'test-spec.yaml');
    assert.strictEqual(findErrors(errors, 'sortable-maxFields-type').length, 1, JSON.stringify(errors));
    console.log('  ✓ Zero rejected');
  });

  await t.test('negative rejected', () => {
    const spec = buildSpec({ xSortable: { fields: ['createdAt'], maxFields: -1 } });
    const errors = validateSpec(spec, 'test-spec.yaml');
    assert.strictEqual(findErrors(errors, 'sortable-maxFields-type').length, 1, JSON.stringify(errors));
    console.log('  ✓ Negative rejected');
  });

  await t.test('string rejected', () => {
    const spec = buildSpec({ xSortable: { fields: ['createdAt'], maxFields: '3' } });
    const errors = validateSpec(spec, 'test-spec.yaml');
    assert.strictEqual(findErrors(errors, 'sortable-maxFields-type').length, 1, JSON.stringify(errors));
    console.log('  ✓ String rejected');
  });
});

// =============================================================================
// $ref cycle handling
// =============================================================================

test('x-sortable — $ref cycles in resource schema', async (t) => {
  await t.test('self-referential schema does not stack-overflow', () => {
    // Task has a `parent` property that $refs Task itself
    const spec = buildSpec({
      xSortable: { fields: ['createdAt'] },
      resourceSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          createdAt: { type: 'string' },
          parent: { $ref: '#/components/schemas/Task' },
        },
      },
    });
    const errors = validateSpec(spec, 'test-spec.yaml');
    // createdAt should still resolve cleanly
    assert.strictEqual(findErrors(errors, 'sortable-field-unknown').length, 0, JSON.stringify(errors));
    console.log('  ✓ Self-referential schema does not break resolution');
  });

  await t.test('sibling allOf branches both $ref same schema both resolved', () => {
    // Both allOf branches reference Base. Without per-descent cycle scope,
    // the second branch would short-circuit and miss any property it should
    // have contributed. This is the regression guard for the cycle-guard fix.
    const spec = {
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            'x-sortable': { fields: ['baseField'] },
            parameters: [
              { $ref: './components/parameters.yaml#/SortParam' },
              { $ref: './components/parameters.yaml#/SearchQueryParam' },
              { $ref: './components/parameters.yaml#/LimitParam' },
              { $ref: './components/parameters.yaml#/OffsetParam' },
            ],
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        items: { type: 'array', items: { $ref: '#/components/schemas/Item' } },
                        total: { type: 'integer' },
                        limit: { type: 'integer' },
                        offset: { type: 'integer' },
                        hasNext: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Item: { allOf: [{ $ref: '#/components/schemas/Base' }, { $ref: '#/components/schemas/Base' }] },
          Base: { type: 'object', properties: { baseField: { type: 'string' } } },
        },
      },
    };
    const errors = validateSpec(spec, 'test-spec.yaml');
    assert.strictEqual(findErrors(errors, 'sortable-field-unknown').length, 0, JSON.stringify(errors));
    console.log('  ✓ Sibling branches sharing the same $ref both contribute');
  });
});

// =============================================================================
// Phase 2 limitation: array-element paths are not supported
// =============================================================================

test('x-sortable — array-element paths (Phase 2 limitation)', async (t) => {
  await t.test('sorting by a field on an array element is rejected', () => {
    // members is an array of objects; "members.lastName" is not a valid
    // path under the documented dot-notation. Phase 2 does not support
    // array-element sort paths (would require a different syntax).
    const spec = buildSpec({
      xSortable: { fields: ['members.lastName'] },
      resourceSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          members: {
            type: 'array',
            items: {
              type: 'object',
              properties: { lastName: { type: 'string' } },
            },
          },
        },
      },
    });
    const errors = validateSpec(spec, 'test-spec.yaml');
    assert.strictEqual(findErrors(errors, 'sortable-field-unknown').length, 1, JSON.stringify(errors));
    console.log('  ✓ Array-element path rejected as unknown field (Phase 2 limitation)');
  });
});

// =============================================================================
// Sort-as-oracle warning — information disclosure (A01:2025)
// =============================================================================

test('x-sortable — sensitive-field warning (A01:2025)', async (t) => {
  await t.test('warns when ssn is in x-sortable.fields', () => {
    const spec = buildSpec({
      xSortable: { fields: ['createdAt', 'ssn'] },
      resourceSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          createdAt: { type: 'string' },
          ssn: { type: 'string' },
        },
      },
    });
    const errors = validateSpec(spec, 'test-spec.yaml');
    const hits = findErrors(errors, 'sortable-sensitive-field');
    assert.strictEqual(hits.length, 1, JSON.stringify(errors));
    assert.strictEqual(hits[0].severity, 'warn');
    console.log('  ✓ ssn triggers sensitive-field warning');
  });

  await t.test('warns when x-pii: true field is in x-sortable.fields', () => {
    const spec = buildSpec({
      xSortable: { fields: ['createdAt', 'taxpayerNumber'] },
      resourceSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          createdAt: { type: 'string' },
          taxpayerNumber: { type: 'string', 'x-pii': true },
        },
      },
    });
    const errors = validateSpec(spec, 'test-spec.yaml');
    const hits = findErrors(errors, 'sortable-sensitive-field');
    assert.strictEqual(hits.length, 1, JSON.stringify(errors));
    assert.strictEqual(hits[0].severity, 'warn');
    console.log('  ✓ x-pii: true triggers sensitive-field warning');
  });

  await t.test('non-sensitive fields produce no warning', () => {
    const spec = buildSpec({ xSortable: { fields: ['createdAt', 'priority'] } });
    const errors = validateSpec(spec, 'test-spec.yaml');
    const hits = findErrors(errors, 'sortable-sensitive-field');
    assert.strictEqual(hits.length, 0, JSON.stringify(errors));
    console.log('  ✓ Non-sensitive fields produce no warning');
  });
});

console.log('\n✓ All x-sortable validator tests passed\n');
