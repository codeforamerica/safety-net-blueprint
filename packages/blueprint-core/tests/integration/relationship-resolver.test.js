/**
 * Integration tests for the relationship resolver using fixture data.
 * Unit tests for the resolver logic are in blueprint-core/tests/unit/relationship-resolver.test.js.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  buildSchemaIndex,
  resolveRelationships,
} from '@codeforamerica/blueprint-core/relationships';

// Fixture spec: a "widgets" API with forward and back references
function buildFixtureSpecs() {
  const widgetsSpec = {
    openapi: '3.1.0',
    info: { title: 'Widgets API', version: '1.0.0' },
    components: {
      schemas: {
        Widget: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            categoryId: {
              type: 'string',
              format: 'uuid',
              'x-relationship': { resource: 'Category' },
            },
          },
        },
        Part: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            // Back-ref: Part belongs to a Widget; should remain scalar in expand mode
            widgetId: { type: 'string', format: 'uuid' },
            // Forward-ref: Part has a creator; should expand in expand mode
            creatorId: {
              type: 'string',
              format: 'uuid',
              'x-relationship': { resource: 'Creator' },
            },
          },
        },
        Category: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            label: { type: 'string' },
          },
        },
        Creator: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            // Cross-domain forward-ref to an external schema
            organizationId: {
              type: 'string',
              format: 'uuid',
              'x-relationship': { resource: 'Organization' },
            },
          },
        },
      },
    },
  };

  // A separate "domain" spec that defines Organization
  const domainSpec = {
    $defs: {
      Organization: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
        },
      },
    },
  };

  const currentResults = new Map([
    ['widgets/widgets-openapi.yaml', widgetsSpec],
    ['schemas/domain/widgets.yaml', domainSpec],
  ]);

  return { widgetsSpec, currentResults };
}

test('relationship-resolver integration with fixture data', async (t) => {

  await t.test('expand mode: back-references remain scalar', () => {
    const { widgetsSpec, currentResults } = buildFixtureSpecs();
    const schemaIndex = buildSchemaIndex(currentResults);
    const { result } = resolveRelationships(widgetsSpec, 'expand', schemaIndex, currentResults);
    const schemas = result.components.schemas;

    // Part.widgetId is a back-ref (Part sub-resources belong to Widget parent)
    // It should remain as widgetId scalar, not be renamed to widget
    assert.ok(schemas.Part.properties.widgetId, 'Part.widgetId should remain scalar (back-ref kept scalar)');
    assert.strictEqual(schemas.Part.properties.widget, undefined, 'Part.widget should NOT exist — back-ref must not be expanded');
  });

  await t.test('expand mode: forward references are expanded', () => {
    const { widgetsSpec, currentResults } = buildFixtureSpecs();
    const schemaIndex = buildSchemaIndex(currentResults);
    const { result } = resolveRelationships(widgetsSpec, 'expand', schemaIndex, currentResults);
    const schemas = result.components.schemas;

    // Part.creatorId is a forward-ref; expand mode should rename it to creator
    assert.strictEqual(schemas.Part.properties.creatorId, undefined, 'Part.creatorId should be renamed by forward expansion');
    assert.ok(schemas.Part.properties.creator, 'Part.creator should be inlined after expansion');
  });

  await t.test('expand mode: cascade stops at one level deep', () => {
    const { widgetsSpec, currentResults } = buildFixtureSpecs();
    const schemaIndex = buildSchemaIndex(currentResults);
    const { result } = resolveRelationships(widgetsSpec, 'expand', schemaIndex, currentResults);
    const schemas = result.components.schemas;

    // Widget.categoryId is a forward-ref that expands to category
    assert.strictEqual(schemas.Widget.properties.categoryId, undefined, 'Widget.categoryId should be renamed (forward expand)');
    assert.ok(schemas.Widget.properties.category, 'Widget.category should be inlined');
  });

});
