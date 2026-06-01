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
  buildExamplesIndex,
  resolveExampleRelationships,
  findPathsForSchema,
  isBackReference,
  summarizeResolverDecisions
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
  // findPathsForSchema
  // ===========================================================================

  await t.test('findPathsForSchema - finds path serving the schema as direct response', () => {
    const spec = {
      paths: {
        '/users/{userId}': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/User' }
                  }
                }
              }
            }
          }
        }
      }
    };
    assert.deepStrictEqual(findPathsForSchema(spec, 'User'), ['/users/{userId}']);
  });

  await t.test('findPathsForSchema - finds path serving the schema as inline array response', () => {
    const spec = {
      paths: {
        '/users': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { $ref: '#/components/schemas/User' } }
                  }
                }
              }
            }
          }
        }
      }
    };
    assert.deepStrictEqual(findPathsForSchema(spec, 'User'), ['/users']);
  });

  await t.test('findPathsForSchema - finds path via requestBody', () => {
    const spec = {
      paths: {
        '/users': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/UserCreate' }
                }
              }
            },
            responses: { '201': {} }
          }
        }
      }
    };
    assert.deepStrictEqual(findPathsForSchema(spec, 'UserCreate'), ['/users']);
  });

  await t.test('findPathsForSchema - returns multiple paths when schema served at several', () => {
    const spec = {
      paths: {
        '/users/{userId}': {
          get: {
            responses: {
              '200': {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } }
              }
            }
          }
        },
        '/admin/users/{userId}': {
          get: {
            responses: {
              '200': {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } }
              }
            }
          }
        }
      }
    };
    const paths = findPathsForSchema(spec, 'User');
    assert.strictEqual(paths.length, 2);
    assert.ok(paths.includes('/users/{userId}'));
    assert.ok(paths.includes('/admin/users/{userId}'));
  });

  await t.test('findPathsForSchema - returns empty when schema not referenced by any path', () => {
    const spec = {
      paths: {
        '/users': {
          get: {
            responses: {
              '200': {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } }
              }
            }
          }
        }
      },
      components: { schemas: { OrphanSchema: { type: 'object' } } }
    };
    assert.deepStrictEqual(findPathsForSchema(spec, 'OrphanSchema'), []);
  });

  await t.test('findPathsForSchema - returns empty for spec with no paths', () => {
    assert.deepStrictEqual(findPathsForSchema({}, 'Foo'), []);
    assert.deepStrictEqual(findPathsForSchema({ components: {} }, 'Foo'), []);
    assert.deepStrictEqual(findPathsForSchema(null, 'Foo'), []);
  });

  await t.test('findPathsForSchema - does not follow through wrapper schemas', () => {
    // The list path serves MemberList (the wrapper), not Member directly. Only
    // the item path serves Member. findPathsForSchema only inspects the direct
    // request/response schemas declared on each operation, not the transitive
    // contents of those schemas.
    const spec = {
      paths: {
        '/members': {
          get: {
            responses: {
              '200': {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/MemberList' } } }
              }
            }
          }
        },
        '/members/{memberId}': {
          get: {
            responses: {
              '200': {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Member' } } }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          Member: { type: 'object' },
          MemberList: {
            type: 'object',
            properties: {
              items: { type: 'array', items: { $ref: '#/components/schemas/Member' } }
            }
          }
        }
      }
    };
    assert.deepStrictEqual(findPathsForSchema(spec, 'Member'), ['/members/{memberId}']);
  });

  // ===========================================================================
  // isBackReference
  // ===========================================================================

  await t.test('isBackReference - parent-child inversion is a back-reference', () => {
    const spec = {
      paths: {
        '/applications/{applicationId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Application' } } } } } }
        },
        '/applications/{applicationId}/members/{memberId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationMember' } } } } } }
        }
      }
    };
    assert.strictEqual(isBackReference(spec, 'ApplicationMember', 'Application'), true);
  });

  await t.test('isBackReference - siblings under shared parent are not back-references', () => {
    const spec = {
      paths: {
        '/applications/{applicationId}/members/{memberId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationMember' } } } } } }
        },
        '/applications/{applicationId}/verifications/{verificationId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Verification' } } } } } }
        }
      }
    };
    assert.strictEqual(isBackReference(spec, 'Verification', 'ApplicationMember'), false);
  });

  await t.test('isBackReference - top-level to top-level is not a back-reference', () => {
    const spec = {
      paths: {
        '/tasks/{id}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } } } } }
        },
        '/users/{id}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } } }
        }
      }
    };
    assert.strictEqual(isBackReference(spec, 'Task', 'User'), false);
  });

  await t.test('isBackReference - target with no served path defaults to forward', () => {
    // Cross-spec FK: Person is not served in this spec (it lives in client-management).
    const spec = {
      paths: {
        '/incomes/{id}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Income' } } } } } }
        }
      }
    };
    assert.strictEqual(isBackReference(spec, 'Income', 'Person'), false);
  });

  await t.test('isBackReference - containing schema with no served path defaults to forward', () => {
    // Inline composite or anonymous shapes can't be classified; default to forward.
    const spec = {
      paths: {
        '/users/{id}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } } }
        }
      }
    };
    assert.strictEqual(isBackReference(spec, 'InlineSchema', 'User'), false);
  });

  await t.test('isBackReference - self-reference is not a back-reference', () => {
    const spec = {
      paths: {
        '/persons/{id}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Person' } } } } } }
        }
      }
    };
    assert.strictEqual(isBackReference(spec, 'Person', 'Person'), false);
  });

  await t.test('isBackReference - works across different path-param naming', () => {
    // Parent path uses {applicationId}, child path uses {appId}. Different names,
    // same hierarchical position. Direction detection canonicalizes path params.
    const spec = {
      paths: {
        '/applications/{applicationId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Application' } } } } } }
        },
        '/applications/{appId}/members/{memberId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationMember' } } } } } }
        }
      }
    };
    assert.strictEqual(isBackReference(spec, 'ApplicationMember', 'Application'), true);
  });

  await t.test('isBackReference - polymorphic per-target classification', () => {
    // A single containing schema can have multiple targets; each is classified independently.
    const spec = {
      paths: {
        '/applications/{applicationId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Application' } } } } } }
        },
        '/applications/{applicationId}/members/{memberId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationMember' } } } } } }
        },
        '/persons/{personId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Person' } } } } } }
        }
      }
    };
    // ApplicationMember → Application: back-ref (true)
    assert.strictEqual(isBackReference(spec, 'ApplicationMember', 'Application'), true);
    // ApplicationMember → Person: forward (top-level person, not above member in hierarchy)
    assert.strictEqual(isBackReference(spec, 'ApplicationMember', 'Person'), false);
  });

  await t.test('isBackReference - item/collection variants of a path do not trigger multi-path warning', () => {
    // The common REST convention serves a resource at both its collection path
    // (/foo) and its item path (/foo/{id}). They represent the same
    // hierarchical position and should not be treated as ambiguous.
    const spec = {
      paths: {
        '/applications/{applicationId}/members': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationMember' } } } } } }
        },
        '/applications/{applicationId}/members/{memberId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationMember' } } } } } }
        },
        '/applications/{applicationId}/notes/{noteId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationNote' } } } } } }
        }
      }
    };
    const warnings = [];
    isBackReference(spec, 'ApplicationNote', 'ApplicationMember', warnings);
    assert.ok(
      !warnings.some(w => w.toLowerCase().includes('multiple paths')),
      `Did not expect multi-path warning for item/collection variants; got: ${JSON.stringify(warnings)}`
    );
  });

  await t.test('isBackReference - emits warning when target served at multiple paths', () => {
    // Target served at two unrelated paths — direction detection picks the
    // shortest/most-specific and warns about the ambiguity.
    const spec = {
      paths: {
        '/users/{id}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } } }
        },
        '/admin/users/{id}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } } }
        },
        '/tasks/{id}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } } } } }
        }
      }
    };
    const warnings = [];
    assert.strictEqual(isBackReference(spec, 'Task', 'User', warnings), false);
    assert.ok(
      warnings.some(w => w.includes('User') && w.toLowerCase().includes('multiple')),
      `Expected a warning about multiple paths for User; got: ${JSON.stringify(warnings)}`
    );
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

  await t.test('resolveRelationships expand - renames FK field and replaces with subset schema', () => {
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
                description: 'Reference to the User assigned to this task.',
                'x-relationship': {
                  resource: 'User',
                  style: 'expand',
                  fields: ['id', 'name', 'email']
                }
              }
            }
          },
          User: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' },
              email: { type: 'string', format: 'email' },
              role: { type: 'string' }
            }
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['workflow.yaml', spec]]));
    const { result, warnings } = resolveRelationships(spec, 'links-only', schemaIndex);

    const props = result.components.schemas.Task.properties;

    // FK field removed, renamed field added
    assert.strictEqual(props.assignedToId, undefined, 'FK field should be removed');
    assert.ok(props.assignedTo, 'renamed field should exist');

    // Inline subset with only the requested fields
    assert.strictEqual(props.assignedTo.type, 'object');
    assert.ok(props.assignedTo.properties.id);
    assert.ok(props.assignedTo.properties.name);
    assert.ok(props.assignedTo.properties.email);
    assert.strictEqual(props.assignedTo.properties.role, undefined, 'unrequested fields should be excluded');

    // No query params added (build-time, not request-time)
    assert.strictEqual(result.paths, undefined);

    assert.strictEqual(warnings.length, 0);
  });

  await t.test('resolveRelationships expand - full $ref when no fields specified', () => {
    const spec = {
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

    const props = result.components.schemas.Task.properties;
    assert.strictEqual(props.assignedToId, undefined, 'FK field should be removed');
    assert.strictEqual(props.assignedTo.$ref, '#/components/schemas/User');
  });

  await t.test('resolveRelationships expand - copies cross-spec schema into target spec so $ref resolves', () => {
    // Task is in workflow-spec, User is in users-spec — two separate specs
    const usersSpec = {
      components: {
        schemas: {
          User: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } }
        }
      }
    };
    const workflowSpec = {
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
          }
          // User is NOT in workflowSpec — it lives in usersSpec
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([
      ['workflow-spec.yaml', workflowSpec],
      ['users-spec.yaml', usersSpec]
    ]));
    const { result } = resolveRelationships(workflowSpec, 'links-only', schemaIndex);

    // $ref is present on the expanded field
    assert.strictEqual(result.components.schemas.Task.properties.assignedTo.$ref, '#/components/schemas/User');
    // User schema was copied into the target spec — no dangling $ref
    assert.ok(result.components.schemas.User, 'User schema should be copied into target spec');
    assert.deepStrictEqual(result.components.schemas.User, usersSpec.components.schemas.User);
  });

  await t.test('resolveRelationships expand - transitively copies schemas referenced by the copied schema', () => {
    // Task → User (users-spec), User.$ref → Address (address-spec)
    const addressSpec = {
      components: {
        schemas: {
          Address: { type: 'object', properties: { street: { type: 'string' }, city: { type: 'string' } } }
        }
      }
    };
    const usersSpec = {
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              address: { $ref: '#/components/schemas/Address' }
            }
          }
          // Address is in addressSpec, not here
        }
      }
    };
    const workflowSpec = {
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
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([
      ['workflow-spec.yaml', workflowSpec],
      ['users-spec.yaml', usersSpec],
      ['address-spec.yaml', addressSpec]
    ]));
    const { result } = resolveRelationships(workflowSpec, 'links-only', schemaIndex);

    // Both User and its transitive dep Address are copied into the target spec
    assert.ok(result.components.schemas.User, 'User should be copied into target spec');
    assert.ok(result.components.schemas.Address, 'Address (transitive dep) should be copied into target spec');
    assert.deepStrictEqual(result.components.schemas.Address, addressSpec.components.schemas.Address);
  });

  await t.test('resolveRelationships expand - updates required array when FK field was required', () => {
    const spec = {
      components: {
        schemas: {
          Task: {
            type: 'object',
            required: ['id', 'assignedToId'],
            properties: {
              id: { type: 'string', format: 'uuid' },
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

    assert.deepStrictEqual(result.components.schemas.Task.required, ['id', 'assignedTo']);
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

    const props = result.components.schemas.Task.properties;

    // assignedToId removed, assignedTo added with expanded schema (per-field override)
    assert.strictEqual(props.assignedToId, undefined, 'FK field should be removed');
    assert.ok(props.assignedTo, 'renamed expanded field should exist');
    assert.ok(props.assignedTo.properties?.id);
    assert.ok(props.assignedTo.properties?.name);

    // caseId should get links (global default)
    assert.strictEqual(props.caseId['x-relationship'], undefined);
    assert.ok(props.links, 'links object should exist for caseId');
    assert.ok(props.links.properties.case);
  });

  // ===========================================================================
  // resolveRelationships — direction gate
  // ===========================================================================

  await t.test('direction gate - global expand keeps back-references as scalar (links-only)', () => {
    const spec = {
      paths: {
        '/applications/{applicationId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Application' } } } } } }
        },
        '/applications/{applicationId}/members/{memberId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationMember' } } } } } }
        }
      },
      components: {
        schemas: {
          Application: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
          ApplicationMember: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              applicationId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Application' }
              }
            }
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { result } = resolveRelationships(spec, 'expand', schemaIndex);

    const props = result.components.schemas.ApplicationMember.properties;
    assert.ok(props.applicationId, 'applicationId scalar should remain');
    assert.strictEqual(props.application, undefined, 'no embedded application field should be created');
    assert.strictEqual(props.applicationId['x-relationship'], undefined, 'x-relationship should be stripped (links-only treatment)');
    assert.ok(props.links, 'links object should be added for the back-reference');
    assert.ok(props.links.properties.application, 'links.application entry should exist');
  });

  await t.test('direction gate - global expand expands forward references', () => {
    const spec = {
      paths: {
        '/persons/{personId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Person' } } } } } }
        },
        '/applications/{applicationId}/members/{memberId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationMember' } } } } } }
        }
      },
      components: {
        schemas: {
          Person: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
          ApplicationMember: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              personId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Person' }
              }
            }
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { result } = resolveRelationships(spec, 'expand', schemaIndex);

    const props = result.components.schemas.ApplicationMember.properties;
    assert.strictEqual(props.personId, undefined, 'personId should be removed (forward expanded)');
    assert.ok(props.person, 'person should be inlined');
  });

  await t.test('direction gate - per-field expand with fields on back-reference is honored silently', () => {
    // Explicit `style: expand` on a back-reference is allowed when `fields` is
    // supplied — the subset path bounds example expansion to the dot-notation
    // depth, sidestepping the unbounded-recursion risk that motivates the
    // direction gate. No warning is emitted; the author opted in explicitly.
    const spec = {
      paths: {
        '/applications/{applicationId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Application' } } } } } }
        },
        '/applications/{applicationId}/members/{memberId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationMember' } } } } } }
        }
      },
      components: {
        schemas: {
          Application: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } } },
          ApplicationMember: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              applicationId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Application', style: 'expand', fields: ['id', 'name'] }
              }
            }
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { result, warnings } = resolveRelationships(spec, 'expand', schemaIndex);

    const props = result.components.schemas.ApplicationMember.properties;
    assert.strictEqual(props.applicationId, undefined, 'applicationId removed by explicit expand');
    assert.ok(props.application, 'application should be inlined per explicit override');
    assert.strictEqual(props.application.type, 'object', 'subset uses inline object, not $ref');
    assert.ok(props.application.properties.id && props.application.properties.name, 'subset contains the requested fields');
    assert.ok(
      !warnings.some(w => w.toLowerCase().includes('back-reference')),
      `Did not expect a back-reference warning when fields is supplied; got: ${JSON.stringify(warnings)}`
    );
  });

  await t.test('direction gate - example data for back-ref expand with fields contains only the subset', () => {
    // End-to-end check of the most complex direction-gated path: explicit
    // back-reference override + fields subset, exercised through both
    // resolveRelationships (which produces the expandRenames) and
    // resolveExampleRelationships (which consumes them). Verifies that the
    // example output for the back-reference contains exactly the requested
    // fields — not the full related record, not just the id, and with no
    // leakage from properties not listed in fields.
    const spec = {
      paths: {
        '/applications/{applicationId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Application' } } } } } }
        },
        '/applications/{applicationId}/members/{memberId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationMember' } } } } } }
        }
      },
      components: {
        schemas: {
          Application: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' },
              status: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' }
            }
          },
          ApplicationMember: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              applicationId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Application', style: 'expand', fields: ['id', 'name'] }
              }
            }
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { expandRenames } = resolveRelationships(spec, 'expand', schemaIndex);

    // Sanity-check: the rename produced by the schema resolver carries the
    // fields subset through to whatever consumes it.
    const memberRename = expandRenames.find(r => r.schemaName === 'ApplicationMember' && r.propertyName === 'applicationId');
    assert.ok(memberRename, 'expandRenames should include the back-ref');
    assert.deepStrictEqual(memberRename.fields, ['id', 'name'], 'fields subset should be preserved on the rename record');

    const examplesData = {
      MemberExample1: { id: 'member-001', applicationId: 'app-001' }
    };
    const examplesIndex = new Map([
      ['app-001', {
        id: 'app-001',
        name: 'Leslie Trent — MAGI + SNAP',
        status: 'submitted',
        createdAt: '2026-05-01T12:00:00Z'
      }]
    ]);

    const { result: examples, warnings } = resolveExampleRelationships(examplesData, expandRenames, examplesIndex);

    assert.strictEqual(examples.MemberExample1.applicationId, undefined, 'FK field should be removed from example');
    assert.ok(examples.MemberExample1.application, 'application field should be inlined in example');
    assert.deepStrictEqual(
      examples.MemberExample1.application,
      { id: 'app-001', name: 'Leslie Trent — MAGI + SNAP' },
      'inlined application should contain exactly the fields subset and no other properties'
    );
    assert.strictEqual(examples.MemberExample1.application.status, undefined, 'unrequested field "status" must not leak');
    assert.strictEqual(examples.MemberExample1.application.createdAt, undefined, 'unrequested field "createdAt" must not leak');
    assert.strictEqual(warnings.length, 0, `expected no warnings; got: ${JSON.stringify(warnings)}`);
  });

  await t.test('direction gate - per-field expand on back-reference without fields throws', () => {
    // Without `fields`, example expansion takes the recursive path; combined
    // with a mutual-expand annotation it could hang. We require `fields` so
    // the bounded `buildExampleSubset` path is used instead.
    const spec = {
      paths: {
        '/applications/{applicationId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Application' } } } } } }
        },
        '/applications/{applicationId}/members/{memberId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationMember' } } } } } }
        }
      },
      components: {
        schemas: {
          Application: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
          ApplicationMember: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              applicationId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Application', style: 'expand' }
              }
            }
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    assert.throws(
      () => resolveRelationships(spec, 'expand', schemaIndex),
      /ApplicationMember\.applicationId.*back-reference.*fields/
    );
  });

  await t.test('direction gate - per-field expand on back-reference with empty fields throws', () => {
    // Falls under the broader "fields must be non-empty" rule but worth a
    // focused test since the back-ref code path looks at !fields and a
    // technically-present empty array would otherwise satisfy that check.
    const spec = {
      paths: {
        '/applications/{applicationId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Application' } } } } } }
        },
        '/applications/{applicationId}/members/{memberId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationMember' } } } } } }
        }
      },
      components: {
        schemas: {
          Application: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
          ApplicationMember: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              applicationId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Application', style: 'expand', fields: [] }
              }
            }
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    assert.throws(
      () => resolveRelationships(spec, 'expand', schemaIndex),
      /fields must be a non-empty array/
    );
  });

  await t.test('validation - empty fields array throws regardless of direction or style', () => {
    // Even on a forward reference, `fields: []` produces a useless empty
    // object in both the schema and example output and is rejected at
    // resolve time.
    const spec = {
      paths: {
        '/tasks/{id}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } } } } }
        },
        '/users/{id}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } } }
        }
      },
      components: {
        schemas: {
          User: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
          Task: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              assignedToId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'User', style: 'expand', fields: [] }
              }
            }
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    assert.throws(
      () => resolveRelationships(spec, 'links-only', schemaIndex),
      /Task\.assignedToId.*fields must be a non-empty array/
    );
  });

  await t.test('direction gate - per-field links-only on back-reference keeps scalar (no warning)', () => {
    // Existing behavior: explicit per-field links-only beats global expand regardless of direction.
    // No back-reference-override warning should fire (the override is in the conservative direction).
    const spec = {
      paths: {
        '/applications/{applicationId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Application' } } } } } }
        },
        '/applications/{applicationId}/members/{memberId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationMember' } } } } } }
        }
      },
      components: {
        schemas: {
          Application: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
          ApplicationMember: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              applicationId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Application', style: 'links-only' }
              }
            }
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { result, warnings } = resolveRelationships(spec, 'expand', schemaIndex);

    const props = result.components.schemas.ApplicationMember.properties;
    assert.ok(props.applicationId, 'applicationId scalar should remain');
    assert.strictEqual(props.application, undefined, 'no embedded application field');
    assert.ok(props.links, 'links object should be added');
    assert.ok(
      !warnings.some(w => w.toLowerCase().includes('back-reference')),
      `Did not expect a back-reference warning; got: ${JSON.stringify(warnings)}`
    );
  });

  await t.test('direction gate - global expand on a lateral expands but cascade stops at one level', () => {
    const spec = {
      paths: {
        '/applications/{applicationId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Application' } } } } } }
        },
        '/applications/{applicationId}/members/{memberId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationMember' } } } } } }
        },
        '/applications/{applicationId}/verifications/{verificationId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Verification' } } } } } }
        }
      },
      components: {
        schemas: {
          Application: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
          ApplicationMember: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              applicationId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Application' }
              }
            }
          },
          Verification: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              memberId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'ApplicationMember' }
              }
            }
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { result } = resolveRelationships(spec, 'expand', schemaIndex);

    // Verification.memberId is a lateral (forward) → expand to Verification.member
    const verificationProps = result.components.schemas.Verification.properties;
    assert.strictEqual(verificationProps.memberId, undefined, 'memberId removed by lateral expansion');
    assert.ok(verificationProps.member, 'Verification.member should be inlined');

    // ApplicationMember.applicationId is a back-reference → stays scalar (cascade stops here)
    const memberProps = result.components.schemas.ApplicationMember.properties;
    assert.ok(memberProps.applicationId, 'inlined ApplicationMember.applicationId stays scalar');
    assert.strictEqual(memberProps.application, undefined, 'no embedded application — cascade stopped');
  });

  await t.test('direction gate - ApplicationNote lateral expansion stops cascade', () => {
    // ApplicationNote.memberId points sideways to ApplicationMember (both children
    // of Application). Under global expand: note.member is inlined; the inlined
    // ApplicationMember.applicationId stays scalar.
    const spec = {
      paths: {
        '/applications/{applicationId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Application' } } } } } }
        },
        '/applications/{applicationId}/members/{memberId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationMember' } } } } } }
        },
        '/applications/{applicationId}/notes/{noteId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationNote' } } } } } }
        }
      },
      components: {
        schemas: {
          Application: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
          ApplicationMember: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              applicationId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Application' }
              }
            }
          },
          ApplicationNote: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              memberId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'ApplicationMember' }
              }
            }
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { result } = resolveRelationships(spec, 'expand', schemaIndex);

    const noteProps = result.components.schemas.ApplicationNote.properties;
    assert.strictEqual(noteProps.memberId, undefined, 'memberId removed by lateral expansion');
    assert.ok(noteProps.member, 'ApplicationNote.member should be inlined');

    const memberProps = result.components.schemas.ApplicationMember.properties;
    assert.ok(memberProps.applicationId, 'inlined ApplicationMember.applicationId stays scalar');
    assert.strictEqual(memberProps.application, undefined, 'no embedded application — cascade stopped');
  });

  await t.test('direction gate - ReviewProgressEntry lateral expansion stops cascade', () => {
    // Same shape as the ApplicationNote case: ReviewProgressEntry is a sibling of
    // ApplicationMember under the application URL tree.
    const spec = {
      paths: {
        '/applications/{applicationId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Application' } } } } } }
        },
        '/applications/{applicationId}/members/{memberId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationMember' } } } } } }
        },
        '/applications/{applicationId}/review-progress/{entryId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ReviewProgressEntry' } } } } } }
        }
      },
      components: {
        schemas: {
          Application: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
          ApplicationMember: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              applicationId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Application' }
              }
            }
          },
          ReviewProgressEntry: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              memberId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'ApplicationMember' }
              }
            }
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { result } = resolveRelationships(spec, 'expand', schemaIndex);

    const entryProps = result.components.schemas.ReviewProgressEntry.properties;
    assert.strictEqual(entryProps.memberId, undefined, 'memberId removed by lateral expansion');
    assert.ok(entryProps.member, 'ReviewProgressEntry.member should be inlined');

    const memberProps = result.components.schemas.ApplicationMember.properties;
    assert.ok(memberProps.applicationId, 'inlined ApplicationMember.applicationId stays scalar');
    assert.strictEqual(memberProps.application, undefined, 'no embedded application — cascade stopped');
  });

  // ===========================================================================
  // Resolver decisions
  // ===========================================================================

  await t.test('resolver decisions - tracks per-schema field categorization under global expand', () => {
    const spec = {
      paths: {
        '/persons/{personId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Person' } } } } } }
        },
        '/applications/{applicationId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Application' } } } } } }
        },
        '/applications/{applicationId}/members/{memberId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationMember' } } } } } }
        }
      },
      components: {
        schemas: {
          Person: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
          Application: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
          ApplicationMember: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              personId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Person' }
              },
              applicationId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Application' }
              }
            }
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { decisions } = resolveRelationships(spec, 'expand', schemaIndex);

    assert.ok(decisions, 'decisions should be returned');
    const memberDecisions = decisions['ApplicationMember'];
    assert.ok(memberDecisions, 'decisions for ApplicationMember should exist');
    assert.deepStrictEqual(
      memberDecisions.expandedForward,
      [{ propertyName: 'personId', resource: 'Person' }],
      'forward expansion tracked'
    );
    assert.deepStrictEqual(
      memberDecisions.backRefsDowngraded,
      [{ propertyName: 'applicationId', resource: 'Application' }],
      'back-ref downgrade tracked'
    );
    assert.deepStrictEqual(memberDecisions.expandedExplicitBackRef, [], 'no explicit overrides');
    assert.deepStrictEqual(memberDecisions.linksOnly, [], 'no links-only fields under global expand');
  });

  await t.test('resolver decisions - tracks explicit back-reference override', () => {
    const spec = {
      paths: {
        '/applications/{applicationId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Application' } } } } } }
        },
        '/applications/{applicationId}/members/{memberId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationMember' } } } } } }
        }
      },
      components: {
        schemas: {
          Application: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
          ApplicationMember: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              applicationId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Application', style: 'expand', fields: ['id'] }
              }
            }
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { decisions } = resolveRelationships(spec, 'expand', schemaIndex);

    const memberDecisions = decisions['ApplicationMember'];
    assert.deepStrictEqual(
      memberDecisions.expandedExplicitBackRef,
      [{ propertyName: 'applicationId', resource: 'Application' }],
      'explicit back-ref override tracked'
    );
    assert.deepStrictEqual(memberDecisions.backRefsDowngraded, [], 'no downgrade (override won)');
    assert.deepStrictEqual(memberDecisions.expandedForward, [], 'no forward expansions');
  });

  await t.test('resolver decisions - tracks links-only fields under global links-only', () => {
    const spec = {
      paths: {
        '/applications/{applicationId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Application' } } } } } }
        },
        '/applications/{applicationId}/members/{memberId}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationMember' } } } } } }
        }
      },
      components: {
        schemas: {
          Application: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
          ApplicationMember: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              applicationId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Application' }
              }
            }
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { decisions } = resolveRelationships(spec, 'links-only', schemaIndex);

    const memberDecisions = decisions['ApplicationMember'];
    assert.deepStrictEqual(
      memberDecisions.linksOnly,
      [{ propertyName: 'applicationId', resource: 'Application' }],
      'links-only field tracked under global links-only'
    );
    assert.deepStrictEqual(memberDecisions.backRefsDowngraded, [], 'no downgrades when global is already links-only');
  });

  await t.test('summarizeResolverDecisions - produces per-schema counts', () => {
    const decisions = {
      MemberIncome: {
        expandedForward: [{ propertyName: 'personId', resource: 'Person' }],
        expandedExplicitBackRef: [],
        backRefsDowngraded: [
          { propertyName: 'applicationId', resource: 'Application' },
          { propertyName: 'memberId', resource: 'ApplicationMember' }
        ],
        linksOnly: []
      },
      Task: {
        expandedForward: [],
        expandedExplicitBackRef: [],
        backRefsDowngraded: [],
        linksOnly: [{ propertyName: 'assignedToId', resource: 'User' }]
      }
    };

    const summary = summarizeResolverDecisions(decisions);

    assert.deepStrictEqual(summary.MemberIncome, {
      expandedForward: 1,
      expandedExplicitBackRef: 0,
      backRefsDowngraded: 2,
      linksOnly: 0,
      total: 3
    });
    assert.deepStrictEqual(summary.Task, {
      expandedForward: 0,
      expandedExplicitBackRef: 0,
      backRefsDowngraded: 0,
      linksOnly: 1,
      total: 1
    });
  });

  // ===========================================================================
  // Dot notation — spec transform
  // ===========================================================================

  await t.test('expand fields dot notation - one level deep', () => {
    const spec = {
      components: {
        schemas: {
          Task: {
            type: 'object',
            properties: {
              caseId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': {
                  resource: 'Case',
                  style: 'expand',
                  fields: ['id', 'status', 'application.id', 'application.name']
                }
              }
            }
          },
          Case: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              status: { type: 'string' },
              applicationId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Application' }
              }
            }
          },
          Application: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' },
              status: { type: 'string' }
            }
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { result, warnings } = resolveRelationships(spec, 'links-only', schemaIndex);

    const caseProps = result.components.schemas.Task.properties.case.properties;

    // Simple fields
    assert.ok(caseProps.id);
    assert.ok(caseProps.status);

    // Dot-notation fields produce nested object
    assert.ok(caseProps.application, 'application should exist');
    assert.strictEqual(caseProps.application.type, 'object');
    assert.ok(caseProps.application.properties.id);
    assert.ok(caseProps.application.properties.name);
    assert.strictEqual(caseProps.application.properties.status, undefined, 'unrequested field excluded');

    assert.strictEqual(warnings.length, 0);
  });

  await t.test('expand fields dot notation - two levels deep', () => {
    const spec = {
      components: {
        schemas: {
          Task: {
            type: 'object',
            properties: {
              caseId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': {
                  resource: 'Case',
                  style: 'expand',
                  fields: ['id', 'application.program.name']
                }
              }
            }
          },
          Case: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              applicationId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Application' }
              }
            }
          },
          Application: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              programId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Program' }
              }
            }
          },
          Program: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string' }
            }
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { result, warnings } = resolveRelationships(spec, 'links-only', schemaIndex);

    const caseProps = result.components.schemas.Task.properties.case.properties;
    assert.ok(caseProps.id);
    assert.ok(caseProps.application.properties.program.properties.name);
    assert.strictEqual(warnings.length, 0);
  });

  await t.test('expand fields dot notation - warns when no x-relationship found for path segment', () => {
    const spec = {
      components: {
        schemas: {
          Task: {
            type: 'object',
            properties: {
              caseId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': {
                  resource: 'Case',
                  style: 'expand',
                  fields: ['id', 'notes.text']  // notes is not an FK relationship
                }
              }
            }
          },
          Case: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              notes: { type: 'string' }  // plain field, no x-relationship
            }
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { warnings } = resolveRelationships(spec, 'links-only', schemaIndex);
    assert.ok(warnings.some(w => w.includes('notes') && w.includes('x-relationship')));
  });

  // ===========================================================================
  // Dot notation — example transform
  // ===========================================================================

  await t.test('resolveExampleRelationships - dot notation one level deep', () => {
    const examplesData = {
      TaskExample1: { id: 'task-001', caseId: 'case-001' }
    };

    const expandRenames = [{
      propertyName: 'caseId',
      expandedFieldName: 'case',
      resource: 'Case',
      fields: ['id', 'application.id', 'application.name']
    }];

    const examplesIndex = new Map([
      ['case-001', { id: 'case-001', status: 'open', applicationId: 'app-001' }],
      ['app-001', { id: 'app-001', name: 'Rivera SNAP', status: 'submitted' }]
    ]);

    const { result, warnings } = resolveExampleRelationships(examplesData, expandRenames, examplesIndex);

    assert.strictEqual(warnings.length, 0);
    const c = result.TaskExample1.case;
    assert.strictEqual(c.id, 'case-001');
    assert.strictEqual(c.application.id, 'app-001');
    assert.strictEqual(c.application.name, 'Rivera SNAP');
    assert.strictEqual(c.application.status, undefined, 'unrequested field excluded');
    assert.strictEqual(c.status, undefined, 'unrequested top-level field excluded');
  });

  await t.test('resolveExampleRelationships - dot notation two levels deep', () => {
    const examplesData = {
      TaskExample1: { id: 'task-001', caseId: 'case-001' }
    };

    const expandRenames = [{
      propertyName: 'caseId',
      expandedFieldName: 'case',
      resource: 'Case',
      fields: ['id', 'application.program.name']
    }];

    const examplesIndex = new Map([
      ['case-001', { id: 'case-001', applicationId: 'app-001' }],
      ['app-001', { id: 'app-001', programId: 'prog-001' }],
      ['prog-001', { id: 'prog-001', name: 'SNAP' }]
    ]);

    const { result, warnings } = resolveExampleRelationships(examplesData, expandRenames, examplesIndex);

    assert.strictEqual(warnings.length, 0);
    assert.strictEqual(result.TaskExample1.case.application.program.name, 'SNAP');
  });

  await t.test('resolveExampleRelationships - dot notation warns when FK field not found', () => {
    const examplesData = {
      TaskExample1: { id: 'task-001', caseId: 'case-001' }
    };

    const expandRenames = [{
      propertyName: 'caseId',
      expandedFieldName: 'case',
      resource: 'Case',
      fields: ['id', 'widget.name']  // Case record has no widgetId FK
    }];

    const examplesIndex = new Map([
      ['case-001', { id: 'case-001', status: 'open' }]
    ]);

    const { warnings } = resolveExampleRelationships(examplesData, expandRenames, examplesIndex);
    assert.ok(warnings.some(w => w.includes('widget')));
  });

  // ===========================================================================
  // resolveRelationships — linksData output
  // ===========================================================================

  await t.test('resolveRelationships returns linksData for links-only fields', () => {
    const spec = {
      components: {
        schemas: {
          Task: {
            type: 'object',
            properties: {
              assignedToId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'User' }
              },
              caseId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Case', style: 'expand' }
              }
            }
          },
          User: { type: 'object', properties: { id: { type: 'string' } } },
          Case: { type: 'object', properties: { id: { type: 'string' } } }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { linksData, expandRenames } = resolveRelationships(spec, 'links-only', schemaIndex);

    // linksData for the links-only field only
    assert.strictEqual(linksData.length, 1);
    assert.strictEqual(linksData[0].propertyName, 'assignedToId');
    assert.strictEqual(linksData[0].linkName, 'assignedTo');
    assert.strictEqual(linksData[0].resource, 'User');
    assert.strictEqual(linksData[0].basePath, '/users');

    // expand field not in linksData
    assert.strictEqual(expandRenames.length, 1);
    assert.strictEqual(expandRenames[0].propertyName, 'caseId');
  });

  // ===========================================================================
  // resolveExampleRelationships — links-only example transform
  // ===========================================================================

  await t.test('resolveExampleRelationships - adds links object for links-only fields', () => {
    const examplesData = {
      TaskExample1: { id: 'task-001', assignedToId: 'user-001', caseId: 'case-001' }
    };

    const linksData = [
      { propertyName: 'assignedToId', linkName: 'assignedTo', resource: 'User', basePath: '/users' },
      { propertyName: 'caseId', linkName: 'case', resource: 'Case', basePath: '/cases' }
    ];

    const { result, warnings } = resolveExampleRelationships(examplesData, [], new Map(), linksData);

    assert.strictEqual(warnings.length, 0);
    // FK fields stay
    assert.strictEqual(result.TaskExample1.assignedToId, 'user-001');
    assert.strictEqual(result.TaskExample1.caseId, 'case-001');
    // links object added with URIs
    assert.deepStrictEqual(result.TaskExample1.links, {
      assignedTo: '/users/user-001',
      case: '/cases/case-001'
    });
  });

  await t.test('resolveExampleRelationships - skips null FK in links-only', () => {
    const examplesData = {
      TaskExample1: { id: 'task-001', assignedToId: null }
    };

    const linksData = [
      { propertyName: 'assignedToId', linkName: 'assignedTo', resource: 'User', basePath: '/users' }
    ];

    const { result } = resolveExampleRelationships(examplesData, [], new Map(), linksData);

    assert.strictEqual(result.TaskExample1.links, undefined);
  });

  await t.test('resolveExampleRelationships - merges links with existing links object', () => {
    const examplesData = {
      TaskExample1: { id: 'task-001', assignedToId: 'user-001', links: { self: '/tasks/task-001' } }
    };

    const linksData = [
      { propertyName: 'assignedToId', linkName: 'assignedTo', resource: 'User', basePath: '/users' }
    ];

    const { result } = resolveExampleRelationships(examplesData, [], new Map(), linksData);

    assert.deepStrictEqual(result.TaskExample1.links, {
      self: '/tasks/task-001',
      assignedTo: '/users/user-001'
    });
  });

  await t.test('resolveExampleRelationships - skips records without the FK field (links-only)', () => {
    const examplesData = {
      QueueExample1: { id: 'queue-001', name: 'SNAP intake' }
    };

    const linksData = [
      { propertyName: 'assignedToId', linkName: 'assignedTo', resource: 'User', basePath: '/users' }
    ];

    const { result } = resolveExampleRelationships(examplesData, [], new Map(), linksData);

    assert.deepStrictEqual(result.QueueExample1, { id: 'queue-001', name: 'SNAP intake' });
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

  // ===========================================================================
  // resolveRelationships — expandRenames output
  // ===========================================================================

  await t.test('resolveRelationships returns expandRenames for expanded fields', () => {
    const spec = {
      components: {
        schemas: {
          Task: {
            type: 'object',
            properties: {
              assignedToId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'User', style: 'expand', fields: ['id', 'name'] }
              },
              caseId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Case' }
              }
            }
          },
          User: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
          Case: { type: 'object', properties: { id: { type: 'string' } } }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { expandRenames } = resolveRelationships(spec, 'links-only', schemaIndex);

    assert.strictEqual(expandRenames.length, 1);
    assert.strictEqual(expandRenames[0].propertyName, 'assignedToId');
    assert.strictEqual(expandRenames[0].expandedFieldName, 'assignedTo');
    assert.strictEqual(expandRenames[0].resource, 'User');
    assert.deepStrictEqual(expandRenames[0].fields, ['id', 'name']);
  });

  await t.test('resolveRelationships returns empty expandRenames when no expand fields', () => {
    const spec = {
      components: {
        schemas: {
          Task: {
            type: 'object',
            properties: {
              caseId: { type: 'string', 'x-relationship': { resource: 'Case' } }
            }
          },
          Case: { type: 'object', properties: { id: { type: 'string' } } }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { expandRenames } = resolveRelationships(spec, 'links-only', schemaIndex);
    assert.strictEqual(expandRenames.length, 0);
  });

  // ===========================================================================
  // buildExamplesIndex
  // ===========================================================================

  await t.test('buildExamplesIndex - indexes records by id across multiple files', () => {
    const allExamples = [
      {
        TaskExample1: { id: 'task-001', name: 'Review application', assignedToId: 'user-001' },
        TaskExample2: { id: 'task-002', name: 'Schedule interview', assignedToId: 'user-002' }
      },
      {
        UserExample1: { id: 'user-001', name: 'Jane Smith', email: 'jane@example.gov' },
        UserExample2: { id: 'user-002', name: 'John Doe', email: 'john@example.gov' }
      }
    ];

    const index = buildExamplesIndex(allExamples);
    assert.strictEqual(index.size, 4);
    assert.strictEqual(index.get('task-001').name, 'Review application');
    assert.strictEqual(index.get('user-001').email, 'jane@example.gov');
    assert.strictEqual(index.has('nonexistent'), false);
  });

  await t.test('buildExamplesIndex - skips records without id', () => {
    const allExamples = [
      {
        WithId: { id: 'abc-123', name: 'Has ID' },
        WithoutId: { name: 'No ID' }
      }
    ];

    const index = buildExamplesIndex(allExamples);
    assert.strictEqual(index.size, 1);
    assert.ok(index.has('abc-123'));
  });

  // ===========================================================================
  // resolveExampleRelationships
  // ===========================================================================

  await t.test('resolveExampleRelationships - joins FK with full related record', () => {
    const examplesData = {
      TaskExample1: { id: 'task-001', name: 'Review application', assignedToId: 'user-001' }
    };

    const expandRenames = [{
      propertyName: 'assignedToId',
      expandedFieldName: 'assignedTo',
      resource: 'User',
      fields: null
    }];

    const examplesIndex = new Map([
      ['user-001', { id: 'user-001', name: 'Jane Smith', email: 'jane@example.gov' }]
    ]);

    const { result, warnings } = resolveExampleRelationships(examplesData, expandRenames, examplesIndex);

    assert.strictEqual(warnings.length, 0);
    assert.strictEqual(result.TaskExample1.assignedToId, undefined, 'FK field should be removed');
    assert.deepStrictEqual(result.TaskExample1.assignedTo, {
      id: 'user-001', name: 'Jane Smith', email: 'jane@example.gov'
    });
  });

  await t.test('resolveExampleRelationships - recursively expands FK fields on related record when no fields specified', () => {
    // Task.assignedToId → User (no fields), User.teamId → Team (no fields)
    // The full User record should have teamId expanded to team object
    const examplesData = {
      TaskExample1: { id: 'task-001', assignedToId: 'user-001' }
    };

    const expandRenames = [
      { propertyName: 'assignedToId', expandedFieldName: 'assignedTo', resource: 'User', fields: null },
      { propertyName: 'teamId', expandedFieldName: 'team', resource: 'Team', fields: null }
    ];

    const examplesIndex = new Map([
      ['user-001', { id: 'user-001', name: 'Jane Smith', teamId: 'team-001' }],
      ['team-001', { id: 'team-001', name: 'Intake Team' }]
    ]);

    const { result, warnings } = resolveExampleRelationships(examplesData, expandRenames, examplesIndex);

    assert.strictEqual(warnings.length, 0);
    assert.deepStrictEqual(result.TaskExample1.assignedTo, {
      id: 'user-001',
      name: 'Jane Smith',
      team: { id: 'team-001', name: 'Intake Team' }
    });
  });

  await t.test('resolveExampleRelationships - applies fields subset', () => {
    const examplesData = {
      TaskExample1: { id: 'task-001', assignedToId: 'user-001' }
    };

    const expandRenames = [{
      propertyName: 'assignedToId',
      expandedFieldName: 'assignedTo',
      resource: 'User',
      fields: ['id', 'name']
    }];

    const examplesIndex = new Map([
      ['user-001', { id: 'user-001', name: 'Jane Smith', email: 'jane@example.gov', role: 'case_worker' }]
    ]);

    const { result } = resolveExampleRelationships(examplesData, expandRenames, examplesIndex);

    assert.deepStrictEqual(result.TaskExample1.assignedTo, { id: 'user-001', name: 'Jane Smith' });
    assert.strictEqual(result.TaskExample1.assignedTo.email, undefined);
  });

  await t.test('resolveExampleRelationships - warns and preserves UUID when related record not found', () => {
    const examplesData = {
      TaskExample1: { id: 'task-001', assignedToId: 'user-missing' }
    };

    const expandRenames = [{
      propertyName: 'assignedToId',
      expandedFieldName: 'assignedTo',
      resource: 'User',
      fields: null
    }];

    const { result, warnings } = resolveExampleRelationships(examplesData, expandRenames, new Map());

    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('user-missing'));
    assert.strictEqual(result.TaskExample1.assignedToId, undefined);
    assert.strictEqual(result.TaskExample1.assignedTo, 'user-missing');
  });

  await t.test('resolveExampleRelationships - handles null FK gracefully', () => {
    const examplesData = {
      TaskExample1: { id: 'task-001', assignedToId: null }
    };

    const expandRenames = [{
      propertyName: 'assignedToId',
      expandedFieldName: 'assignedTo',
      resource: 'User',
      fields: null
    }];

    const { result, warnings } = resolveExampleRelationships(examplesData, expandRenames, new Map());

    assert.strictEqual(warnings.length, 0);
    assert.strictEqual(result.TaskExample1.assignedTo, null);
  });

  await t.test('resolveExampleRelationships - skips records without the FK field', () => {
    const examplesData = {
      QueueExample1: { id: 'queue-001', name: 'SNAP intake' }
    };

    const expandRenames = [{
      propertyName: 'assignedToId',
      expandedFieldName: 'assignedTo',
      resource: 'User',
      fields: null
    }];

    const { result } = resolveExampleRelationships(examplesData, expandRenames, new Map());

    assert.deepStrictEqual(result.QueueExample1, { id: 'queue-001', name: 'SNAP intake' });
  });

  // ===========================================================================
  // Cycle protection: example expansion and schema-level warning
  // ===========================================================================

  await t.test('resolveExampleRelationships - truncates mutual-forward cycle to { id }', () => {
    // Two top-level resources at the same hierarchy level (no parent/child)
    // both forward-expand each other. The direction gate cannot help — both
    // sides are forward references. Without the seen-set guard, expansion
    // would recurse forever.
    const examplesData = {
      Case1: { id: 'case-001', householdId: 'household-001' },
      Household1: { id: 'household-001', primaryCaseId: 'case-001' }
    };

    const expandRenames = [
      { schemaName: 'Case', propertyName: 'householdId', expandedFieldName: 'household', resource: 'Household', fields: null },
      { schemaName: 'Household', propertyName: 'primaryCaseId', expandedFieldName: 'primaryCase', resource: 'Case', fields: null }
    ];

    const examplesIndex = new Map([
      ['case-001', { id: 'case-001', householdId: 'household-001' }],
      ['household-001', { id: 'household-001', primaryCaseId: 'case-001' }]
    ]);

    const { result, warnings } = resolveExampleRelationships(examplesData, expandRenames, examplesIndex);

    // Case1 → household:Household1 → primaryCase:Case → household:{id only}.
    // The recursion bubbles out once household-001 reappears in the chain.
    assert.ok(result.Case1.household, 'household expanded');
    assert.strictEqual(result.Case1.household.id, 'household-001');
    assert.ok(result.Case1.household.primaryCase, 'primaryCase expanded one more level');
    assert.strictEqual(result.Case1.household.primaryCase.id, 'case-001');
    assert.deepStrictEqual(
      result.Case1.household.primaryCase.household,
      { id: 'household-001' },
      'cycle truncated to { id } when household-001 reappears'
    );
    assert.ok(
      warnings.some(w => w.toLowerCase().includes('cycle') && w.includes('household-001')),
      `Expected a cycle warning naming household-001; got: ${JSON.stringify(warnings)}`
    );
  });

  await t.test('resolveExampleRelationships - truncates self-reference cycle', () => {
    const examplesData = {
      User1: { id: 'user-001', managerId: 'user-001' }
    };

    const expandRenames = [
      { schemaName: 'User', propertyName: 'managerId', expandedFieldName: 'manager', resource: 'User', fields: null }
    ];

    const examplesIndex = new Map([
      ['user-001', { id: 'user-001', managerId: 'user-001' }]
    ]);

    const { result, warnings } = resolveExampleRelationships(examplesData, expandRenames, examplesIndex);

    assert.ok(result.User1.manager, 'manager expanded once');
    assert.deepStrictEqual(
      result.User1.manager.manager,
      { id: 'user-001' },
      'self-reference truncated at second descent'
    );
    assert.ok(
      warnings.some(w => w.toLowerCase().includes('cycle') && w.includes('user-001')),
      `Expected a self-reference cycle warning; got: ${JSON.stringify(warnings)}`
    );
  });

  await t.test('resolveRelationships - warns when full-schema expand graph has a cycle', () => {
    // Two top-level resources (siblings — neither is a back-ref of the other)
    // each annotated to forward-expand the other with no fields subset. The
    // resolved spec ends up with circular $refs, which is valid OpenAPI but
    // breaks many code generators. The resolver should surface this.
    const spec = {
      paths: {
        '/cases/{id}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Case' } } } } } }
        },
        '/households/{id}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Household' } } } } } }
        }
      },
      components: {
        schemas: {
          Case: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              householdId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Household', style: 'expand' }
              }
            }
          },
          Household: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              primaryCaseId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Case', style: 'expand' }
              }
            }
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { warnings } = resolveRelationships(spec, 'links-only', schemaIndex);

    assert.ok(
      warnings.some(w => w.toLowerCase().includes('circular') && w.includes('Case') && w.includes('Household')),
      `Expected a circular-expand warning; got: ${JSON.stringify(warnings)}`
    );
  });

  await t.test('resolveRelationships - no cycle warning when at least one edge has fields subset', () => {
    // Same mutual-forward shape as above but with `fields` on one edge —
    // that edge produces an inline subset, not a $ref, so no circular $ref
    // appears in the resolved spec.
    const spec = {
      paths: {
        '/cases/{id}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Case' } } } } } }
        },
        '/households/{id}': {
          get: { responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Household' } } } } } }
        }
      },
      components: {
        schemas: {
          Case: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              householdId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Household', style: 'expand', fields: ['id'] }
              }
            }
          },
          Household: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              primaryCaseId: {
                type: 'string',
                format: 'uuid',
                'x-relationship': { resource: 'Case', style: 'expand' }
              }
            }
          }
        }
      }
    };

    const schemaIndex = buildSchemaIndex(new Map([['spec.yaml', spec]]));
    const { warnings } = resolveRelationships(spec, 'links-only', schemaIndex);

    assert.ok(
      !warnings.some(w => w.toLowerCase().includes('circular')),
      `Did not expect a circular-expand warning; got: ${JSON.stringify(warnings)}`
    );
  });

  // ===========================================================================
  // Integration: real intake spec under global expand
  // ===========================================================================

  await t.test('integration - intake spec under global expand keeps all 16 back-refs scalar', async () => {
    // Loads the real packages/contracts/intake-openapi.yaml and confirms the
    // direction gate behaves correctly against the full spec. Acts as a
    // regression guard for the design intent documented in the GH issue.
    const { readFileSync } = await import('fs');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const yaml = (await import('js-yaml')).default;

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const contractsDir = join(__dirname, '../..');
    const intakeSpec = yaml.load(readFileSync(join(contractsDir, 'intake-openapi.yaml'), 'utf8'));

    // Build a minimal schema index from intake only. Cross-spec targets (Person,
    // External) will warn during expand but the field-rename happens regardless,
    // which is what the assertions below check.
    const schemaIndex = buildSchemaIndex(new Map([['intake-openapi.yaml', intakeSpec]]));
    const { result } = resolveRelationships(intakeSpec, 'expand', schemaIndex);
    const schemas = result.components.schemas;

    // The 16 back-references documented in safety-net-blueprint#324.
    // Each tuple: [containingSchema, scalarFieldName].
    const backRefs = [
      ['ApplicationMember', 'applicationId'],
      ['MemberIncome', 'memberId'],
      ['MemberIncome', 'applicationId'],
      ['MemberExpense', 'memberId'],
      ['MemberExpense', 'applicationId'],
      ['MemberAsset', 'memberId'],
      ['MemberAsset', 'applicationId'],
      ['MemberEmployment', 'memberId'],
      ['MemberEmployment', 'applicationId'],
      ['MemberHealthCoverage', 'memberId'],
      ['MemberHealthCoverage', 'applicationId'],
      ['ApplicationHousehold', 'applicationId'],
      ['ApplicationNote', 'applicationId'],
      ['Verification', 'applicationId'],
      ['Interview', 'applicationId'],
      ['ReviewProgressEntry', 'applicationId']
    ];

    for (const [schemaName, fieldName] of backRefs) {
      const props = gatherSchemaProperties(schemas[schemaName]);
      assert.ok(
        props[fieldName],
        `${schemaName}.${fieldName} should remain a scalar field (back-ref kept scalar)`
      );
      const renamed = fieldName.replace(/Id$/, '');
      assert.strictEqual(
        props[renamed], undefined,
        `${schemaName}.${renamed} should NOT exist — back-ref was incorrectly expanded`
      );
    }
  });

  await t.test('integration - intake spec expands forward references on member writable schemas', async () => {
    const { readFileSync } = await import('fs');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const yaml = (await import('js-yaml')).default;

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const contractsDir = join(__dirname, '../..');
    const intakeSpec = yaml.load(readFileSync(join(contractsDir, 'intake-openapi.yaml'), 'utf8'));

    const schemaIndex = buildSchemaIndex(new Map([['intake-openapi.yaml', intakeSpec]]));
    const { result } = resolveRelationships(intakeSpec, 'expand', schemaIndex);
    const schemas = result.components.schemas;

    // ApplicationMemberWritable.personId is a forward reference (Person is a
    // top-level resource in its own URL tree, not above ApplicationMember).
    // Under global expand it should be renamed to `person`.
    const writableProps = gatherSchemaProperties(schemas.ApplicationMemberWritable);
    assert.strictEqual(writableProps.personId, undefined, 'personId should be renamed by forward expansion');
    assert.ok(writableProps.person, 'ApplicationMemberWritable.person should be inlined');
  });

  await t.test('integration - intake spec expands laterals but cascade stops at one level', async () => {
    const { readFileSync } = await import('fs');
    const { join, dirname } = await import('path');
    const { fileURLToPath } = await import('url');
    const yaml = (await import('js-yaml')).default;

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const contractsDir = join(__dirname, '../..');
    const intakeSpec = yaml.load(readFileSync(join(contractsDir, 'intake-openapi.yaml'), 'utf8'));

    const schemaIndex = buildSchemaIndex(new Map([['intake-openapi.yaml', intakeSpec]]));
    const { result } = resolveRelationships(intakeSpec, 'expand', schemaIndex);
    const schemas = result.components.schemas;

    // Lateral expansions to ApplicationMember (sibling under /applications/{id}):
    // ApplicationNoteWritable and ReviewProgressEntryWritable each have
    // memberId → ApplicationMember. Under global expand they should be renamed
    // to `member` and inlined.
    for (const laterName of ['ApplicationNoteWritable', 'ReviewProgressEntryWritable']) {
      const props = gatherSchemaProperties(schemas[laterName]);
      assert.strictEqual(props.memberId, undefined, `${laterName}.memberId should be renamed by lateral expansion`);
      assert.ok(props.member, `${laterName}.member should be inlined`);
    }

    // VerificationWritable.sourceId → Polymorphic is a cross-domain forward
    // reference (the target has no served path in this spec). It should still
    // be expanded — renamed to `source` — even though Polymorphic isn't in the
    // schema index. This guards the cross-domain forward-expand path against
    // regressions, in particular ensuring polymorphic / external refs aren't
    // accidentally treated as back-references.
    const verificationProps = gatherSchemaProperties(schemas.VerificationWritable);
    assert.strictEqual(verificationProps.sourceId, undefined, 'VerificationWritable.sourceId should be renamed (cross-domain forward expand)');
    assert.ok(verificationProps.source, 'VerificationWritable.source should be inlined');

    // Cascade stops: the local ApplicationMember (referenced by the lateral's
    // `member` $ref) still has its applicationId as a scalar. Any consumer
    // following the $ref reaches an ApplicationMember whose applicationId
    // never expanded into the full Application object.
    const memberProps = gatherSchemaProperties(schemas.ApplicationMember);
    assert.ok(memberProps.applicationId, 'ApplicationMember.applicationId still scalar (cascade stopped)');
    assert.strictEqual(memberProps.application, undefined, 'no embedded Application — cascade stopped');
  });
});

// Walk a schema (possibly allOf-composed) and return the merged properties
// from all branches. Used by the integration tests to inspect the resolved
// shape regardless of where the property lives.
function gatherSchemaProperties(schema) {
  const merged = {};
  if (!schema) return merged;
  if (schema.properties) Object.assign(merged, schema.properties);
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      Object.assign(merged, gatherSchemaProperties(branch));
    }
  }
  return merged;
}
