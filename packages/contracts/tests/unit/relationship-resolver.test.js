/**
 * Unit tests for relationship-resolver.js
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  discoverRelationships,
  buildSchemaIndex,
  deriveLinkName,
  resolveRelationships,
  findGetEndpoints
} from '../../src/overlay/relationship-resolver.js';

test('relationship-resolver tests', async (t) => {

  // ===========================================================================
  // deriveLinkName
  // ===========================================================================

  await t.test('deriveLinkName - strips Id suffix', () => {
    assert.strictEqual(deriveLinkName('assignedToId'), 'assignedTo');
    assert.strictEqual(deriveLinkName('personId'), 'person');
    assert.strictEqual(deriveLinkName('caseId'), 'case');
    assert.strictEqual(deriveLinkName('primaryApplicantId'), 'primaryApplicant');
  });

  await t.test('deriveLinkName - handles no-suffix case', () => {
    assert.strictEqual(deriveLinkName('owner'), 'owner');
    assert.strictEqual(deriveLinkName('status'), 'status');
  });

  await t.test('deriveLinkName - does not strip "Id" if that is the entire name', () => {
    assert.strictEqual(deriveLinkName('Id'), 'Id');
  });

  // ===========================================================================
  // discoverRelationships
  // ===========================================================================

  await t.test('discoverRelationships - finds annotated properties', () => {
    const spec = {
      components: {
        schemas: {
          Task: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              assignedToId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'User', style: 'links-only' }
              },
              caseId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Case' }
              }
            }
          }
        }
      }
    };

    const results = discoverRelationships(spec);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].schemaName, 'Task');
    assert.strictEqual(results[0].propertyName, 'assignedToId');
    assert.deepStrictEqual(results[0].relationship, { resource: 'User', style: 'links-only' });
    assert.strictEqual(results[1].propertyName, 'caseId');
  });

  await t.test('discoverRelationships - returns empty when no annotations', () => {
    const spec = {
      components: {
        schemas: {
          Task: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' }
            }
          }
        }
      }
    };

    assert.strictEqual(discoverRelationships(spec).length, 0);
  });

  await t.test('discoverRelationships - handles allOf schemas', () => {
    const spec = {
      components: {
        schemas: {
          Task: {
            allOf: [
              { $ref: '#/components/schemas/BaseResource' },
              {
                type: 'object',
                properties: {
                  assignedToId: {
                    type: 'string',
                    format: 'uuid',
                    'x-relationship': { resource: 'User' }
                  }
                }
              }
            ]
          }
        }
      }
    };

    const results = discoverRelationships(spec);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].schemaName, 'Task');
    assert.strictEqual(results[0].propertyName, 'assignedToId');
  });

  await t.test('discoverRelationships - handles missing components.schemas', () => {
    assert.strictEqual(discoverRelationships({}).length, 0);
    assert.strictEqual(discoverRelationships({ components: {} }).length, 0);
    assert.strictEqual(discoverRelationships(null).length, 0);
  });

  // ===========================================================================
  // buildSchemaIndex
  // ===========================================================================

  await t.test('buildSchemaIndex - indexes schemas across multiple specs', () => {
    const specs = new Map([
      ['workflow-openapi.yaml', {
        components: {
          schemas: {
            Task: { type: 'object' },
            Queue: { type: 'object' }
          }
        }
      }],
      ['users-openapi.yaml', {
        components: {
          schemas: {
            User: { type: 'object' }
          }
        }
      }]
    ]);

    const index = buildSchemaIndex(specs);
    assert.strictEqual(index.size, 3);
    assert.strictEqual(index.get('Task').specFile, 'workflow-openapi.yaml');
    assert.strictEqual(index.get('User').specFile, 'users-openapi.yaml');
    assert.strictEqual(index.has('NonExistent'), false);
  });

  await t.test('buildSchemaIndex - handles specs with no schemas', () => {
    const specs = new Map([
      ['empty.yaml', {}],
      ['has-schemas.yaml', { components: { schemas: { Foo: { type: 'object' } } } }]
    ]);

    const index = buildSchemaIndex(specs);
    assert.strictEqual(index.size, 1);
    assert.strictEqual(index.get('Foo').specFile, 'has-schemas.yaml');
  });

  // ===========================================================================
  // findGetEndpoints
  // ===========================================================================

  await t.test('findGetEndpoints - finds direct $ref item endpoint', () => {
    const spec = {
      paths: {
        '/tasks/{taskId}': {
          get: {
            responses: {
              '200': {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } }
              }
            }
          }
        }
      }
    };

    const endpoints = findGetEndpoints(spec, 'Task');
    assert.deepStrictEqual(endpoints, ['/tasks/{taskId}']);
  });

  await t.test('findGetEndpoints - finds list endpoint via $ref to list schema', () => {
    const spec = {
      paths: {
        '/tasks': {
          get: {
            responses: {
              '200': {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskList' } } }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          TaskList: {
            allOf: [
              { $ref: './components/pagination.yaml#/Pagination' },
              {
                type: 'object',
                properties: {
                  items: { type: 'array', items: { $ref: '#/components/schemas/Task' } }
                }
              }
            ]
          }
        }
      }
    };

    const endpoints = findGetEndpoints(spec, 'Task');
    assert.deepStrictEqual(endpoints, ['/tasks']);
  });

  await t.test('findGetEndpoints - finds list endpoint with direct properties', () => {
    const spec = {
      paths: {
        '/queues': {
          get: {
            responses: {
              '200': {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/QueueList' } } }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          QueueList: {
            type: 'object',
            properties: {
              items: { type: 'array', items: { $ref: '#/components/schemas/Queue' } }
            }
          }
        }
      }
    };

    const endpoints = findGetEndpoints(spec, 'Queue');
    assert.deepStrictEqual(endpoints, ['/queues']);
  });

  // ===========================================================================
  // resolveRelationships — links-only
  // ===========================================================================

  await t.test('resolveRelationships links-only - adds links object and strips x-relationship', () => {
    const spec = {
      components: {
        schemas: {
          Task: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', format: 'uuid' },
              assignedToId: {
                type: 'string',
                format: 'uuid',
                description: 'Reference to the User.',
                'x-relationship': { resource: 'User' }
              },
              caseId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Case' }
              }
            }
          }
        }
      }
    };

    const schemaIndex = new Map([
      ['User', { spec: {}, specFile: 'users-openapi.yaml' }],
      ['Case', { spec: {}, specFile: 'case-management-openapi.yaml' }]
    ]);

    const { result, warnings } = resolveRelationships(spec, 'links-only', schemaIndex);

    // x-relationship stripped
    assert.strictEqual(result.components.schemas.Task.properties.assignedToId['x-relationship'], undefined);
    assert.strictEqual(result.components.schemas.Task.properties.caseId['x-relationship'], undefined);

    // links object added
    const links = result.components.schemas.Task.properties.links;
    assert.ok(links);
    assert.strictEqual(links.type, 'object');
    assert.strictEqual(links.readOnly, true);
    assert.strictEqual(links.properties.assignedTo.type, 'string');
    assert.strictEqual(links.properties.assignedTo.format, 'uri');
    assert.strictEqual(links.properties.case.type, 'string');
    assert.strictEqual(links.properties.case.format, 'uri');

    // FK fields preserved
    assert.strictEqual(result.components.schemas.Task.properties.assignedToId.type, 'string');
    assert.strictEqual(result.components.schemas.Task.properties.assignedToId.format, 'uuid');

    assert.strictEqual(warnings.length, 0);
  });

  await t.test('resolveRelationships links-only - handles allOf schema', () => {
    const spec = {
      components: {
        schemas: {
          Task: {
            allOf: [
              { $ref: '#/components/schemas/Base' },
              {
                type: 'object',
                properties: {
                  assignedToId: {
                    type: 'string',
                    format: 'uuid',
                    'x-relationship': { resource: 'User' }
                  }
                }
              }
            ]
          }
        }
      }
    };

    const schemaIndex = new Map([
      ['User', { spec: {}, specFile: 'users.yaml' }]
    ]);

    const { result } = resolveRelationships(spec, 'links-only', schemaIndex);
    const allOfEntry = result.components.schemas.Task.allOf[1];
    assert.ok(allOfEntry.properties.links);
    assert.strictEqual(allOfEntry.properties.links.properties.assignedTo.format, 'uri');
    assert.strictEqual(allOfEntry.properties.assignedToId['x-relationship'], undefined);
  });

  // ===========================================================================
  // resolveRelationships — expand
  // ===========================================================================

  await t.test('resolveRelationships expand - converts to oneOf and adds expand param', () => {
    const userSchema = {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        role: { type: 'string' }
      }
    };

    const spec = {
      paths: {
        '/tasks/{taskId}': {
          get: {
            operationId: 'getTask',
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Task' }
                  }
                }
              }
            }
          }
        },
        '/tasks': {
          get: {
            operationId: 'listTasks',
            parameters: [],
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/TaskList' }
                  }
                }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          Task: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              assignedToId: {
                type: 'string',
                format: 'uuid',
                description: 'Reference to the User assigned to this task.',
                'x-relationship': {
                  resource: 'User',
                  style: 'expand',
                  fields: ['id', 'name', 'email']
                }
              }
            }
          },
          TaskList: {
            allOf: [
              { type: 'object', properties: { total: { type: 'integer' } } },
              { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Task' } } } }
            ]
          },
          User: userSchema
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['workflow.yaml', spec]]));
    const { result, warnings } = resolveRelationships(spec, 'links-only', schemaIndex);

    // FK field converted to oneOf
    const assignedToId = result.components.schemas.Task.properties.assignedToId;
    assert.ok(assignedToId.oneOf);
    assert.strictEqual(assignedToId.oneOf.length, 2);
    assert.strictEqual(assignedToId.oneOf[0].type, 'string');
    assert.strictEqual(assignedToId.oneOf[0].format, 'uuid');
    // Inline subset
    assert.strictEqual(assignedToId.oneOf[1].type, 'object');
    assert.ok(assignedToId.oneOf[1].properties.id);
    assert.ok(assignedToId.oneOf[1].properties.name);
    assert.ok(assignedToId.oneOf[1].properties.email);
    assert.strictEqual(assignedToId.oneOf[1].properties.role, undefined);

    // Description preserved
    assert.strictEqual(assignedToId.description, 'Reference to the User assigned to this task.');

    // x-relationship stripped
    assert.strictEqual(assignedToId['x-relationship'], undefined);

    // Expand query param added to both GET endpoints
    const getTaskParams = result.paths['/tasks/{taskId}'].get.parameters;
    assert.ok(getTaskParams);
    const expandParam = getTaskParams.find(p => p.name === 'expand');
    assert.ok(expandParam);
    assert.strictEqual(expandParam.in, 'query');
    assert.strictEqual(expandParam.schema.type, 'array');

    const listTaskParams = result.paths['/tasks'].get.parameters;
    const listExpandParam = listTaskParams.find(p => p.name === 'expand');
    assert.ok(listExpandParam);

    assert.strictEqual(warnings.length, 0);
  });

  await t.test('resolveRelationships expand - full $ref when no fields specified', () => {
    const spec = {
      paths: {
        '/tasks/{taskId}': {
          get: {
            responses: {
              '200': {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          Task: {
            type: 'object',
            properties: {
              assignedToId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'User', style: 'expand' }
              }
            }
          },
          User: { type: 'object', properties: { id: { type: 'string' } } }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { result } = resolveRelationships(spec, 'links-only', schemaIndex);

    const assignedToId = result.components.schemas.Task.properties.assignedToId;
    assert.strictEqual(assignedToId.oneOf[1].$ref, '#/components/schemas/User');
  });

  // ===========================================================================
  // Per-field style override
  // ===========================================================================

  await t.test('per-field style override - field with expand when global is links-only', () => {
    const spec = {
      paths: {
        '/tasks/{taskId}': {
          get: {
            responses: {
              '200': {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          Task: {
            type: 'object',
            properties: {
              assignedToId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': {
                  resource: 'User',
                  style: 'expand',
                  fields: ['id', 'name']
                }
              },
              caseId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Case' }
              }
            }
          },
          User: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' }
            }
          },
          Case: { type: 'object', properties: { id: { type: 'string' } } }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { result } = resolveRelationships(spec, 'links-only', schemaIndex);

    // assignedToId should be expanded (per-field override)
    const assignedTo = result.components.schemas.Task.properties.assignedToId;
    assert.ok(assignedTo.oneOf, 'assignedToId should have oneOf (expand style)');

    // caseId should get links (global default)
    assert.strictEqual(result.components.schemas.Task.properties.caseId['x-relationship'], undefined);
    assert.ok(result.components.schemas.Task.properties.links, 'links object should exist for caseId');
    assert.ok(result.components.schemas.Task.properties.links.properties.case);
  });

  // ===========================================================================
  // Warnings
  // ===========================================================================

  await t.test('warns when resource references unknown schema', () => {
    const spec = {
      components: {
        schemas: {
          Task: {
            type: 'object',
            properties: {
              widgetId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Widget' }
              }
            }
          }
        }
      }
    };

    const { warnings } = resolveRelationships(spec, 'links-only', new Map());
    assert.ok(warnings.some(w => w.includes('Widget') && w.includes('not found')));
  });

  // ===========================================================================
  // Unimplemented styles
  // ===========================================================================

  await t.test('throws for include style (global)', () => {
    const spec = { components: { schemas: { Foo: { type: 'object', properties: { barId: { type: 'string', 'x-relationship': { resource: 'Bar' } } } } } } };
    assert.throws(
      () => resolveRelationships(spec, 'include'),
      /Style "include" is not yet implemented/
    );
  });

  await t.test('throws for embed style (global)', () => {
    const spec = { components: { schemas: { Foo: { type: 'object', properties: { barId: { type: 'string', 'x-relationship': { resource: 'Bar' } } } } } } };
    assert.throws(
      () => resolveRelationships(spec, 'embed'),
      /Style "embed" is not yet implemented/
    );
  });

  await t.test('throws for per-field include style', () => {
    const spec = {
      components: {
        schemas: {
          Task: {
            type: 'object',
            properties: {
              assignedToId: {
                type: 'string',
                'x-relationship': { resource: 'User', style: 'include' }
              }
            }
          }
        }
      }
    };

    assert.throws(
      () => resolveRelationships(spec, 'links-only'),
      /Style "include" is not yet implemented/
    );
  });

  // ===========================================================================
  // No-op when no annotations
  // ===========================================================================

  await t.test('returns spec unchanged when no x-relationship annotations', () => {
    const spec = {
      components: {
        schemas: {
          Task: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' }
            }
          }
        }
      }
    };

    const { result, warnings } = resolveRelationships(spec, 'links-only');
    assert.deepStrictEqual(result, spec);
    assert.strictEqual(warnings.length, 0);
  });
});
