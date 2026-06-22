/**
 * Unit tests for the compositions resolver.
 * Tests discovery, bind validation, and overlay generation.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import yaml from 'js-yaml';
import {
  discoverCompositions,
  extractResourceSlug,
  collectSchemaProperties,
  buildResourceSchemaIndex,
  validateBindFields,
  validateSortableConfig,
  extractPathParams,
  buildParameterIndex,
  buildPathToSchemaMap,
  generateCompositionOverlay,
  generateCompositionOverlays,
  generateSectionViewPanelEndpoints,
  generateStateSchemas,
} from '../../src/compositions/compositions-resolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function createTempDir() {
  const dir = join(__dirname, `tmp-compositions-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function removeTempDir(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function writeYaml(dir, filename, obj) {
  writeFileSync(join(dir, filename), yaml.dump(obj), 'utf8');
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const minimalComposition = {
  $schema: './schemas/compositions-schema.yaml',
  version: '1.0',
  domain: 'test',
  compositions: {
    memberSummary: {
      resource: 'application-members',
      bind: 'applicationId',
      endpoint: {
        path: '/applications/{applicationId}/member-summary'
      }
    }
  }
};

const sectionViewComposition = {
  $schema: './schemas/compositions-schema.yaml',
  version: '1.0',
  domain: 'intake',
  compositions: {
    reviewContext: {
      compositeType: 'sectionView',
      resource: 'applications',
      endpoint: {
        path: '/applications/{applicationId}/review',
        parentLink: true
      },
      sections: {
        income: {
          resource: 'member-incomes',
          bind: 'applicationId'
        },
        household: {
          resource: 'household-info',
          bind: 'applicationId',
          missing: 'empty'
        }
      },
      panel: {
        include: {
          notes: {
            resource: 'application-notes',
            bind: 'applicationId'
          }
        }
      }
    }
  }
};

const sampleOpenApiSpec = {
  openapi: '3.1.0',
  info: { title: 'Test', version: '1.0.0' },
  paths: {
    '/applications/{applicationId}/member-incomes/{id}': {
      parameters: [{ $ref: '#/components/parameters/ApplicationIdParam' }],
      get: {
        operationId: 'getMemberIncome',
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MemberIncome' }
              }
            }
          }
        }
      }
    },
    '/applications/{applicationId}/household-info': {
      parameters: [{ $ref: '#/components/parameters/ApplicationIdParam' }],
      get: {
        operationId: 'getHouseholdInfo',
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HouseholdInfo' }
              }
            }
          }
        }
      }
    },
    '/applications/{applicationId}/notes/{noteId}': {
      get: {
        operationId: 'getNote',
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApplicationNote' }
              }
            }
          }
        }
      }
    }
  },
  components: {
    parameters: {
      ApplicationIdParam: {
        name: 'applicationId',
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' }
      }
    },
    schemas: {
      MemberIncome: {
        allOf: [
          { $ref: './schemas/common/income.yaml' },
          {
            type: 'object',
            properties: {
              id: { type: 'string' },
              applicationId: { type: 'string' },
              memberId: { type: 'string' },
              amount: { type: 'number' }
            }
          }
        ]
      },
      HouseholdInfo: {
        type: 'object',
        properties: {
          applicationId: { type: 'string' },
          householdSize: { type: 'integer' }
        }
      },
      ApplicationNote: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          applicationId: { type: 'string' },
          text: { type: 'string' }
        }
      }
    }
  }
};

// ---------------------------------------------------------------------------
// discoverCompositions
// ---------------------------------------------------------------------------

describe('discoverCompositions', () => {
  test('returns empty array for missing directory', () => {
    const result = discoverCompositions('/nonexistent/path');
    assert.deepEqual(result, []);
  });

  test('returns empty array for directory with no composition files', () => {
    const dir = createTempDir();
    try {
      writeYaml(dir, 'intake-openapi.yaml', { openapi: '3.1.0' });
      const result = discoverCompositions(dir);
      assert.deepEqual(result, []);
    } finally {
      removeTempDir(dir);
    }
  });

  test('discovers a single composition file', () => {
    const dir = createTempDir();
    try {
      writeYaml(dir, 'test-compositions.yaml', minimalComposition);
      const result = discoverCompositions(dir);
      assert.equal(result.length, 1);
      assert.equal(result[0].domain, 'test');
      assert.ok(result[0].filePath.endsWith('test-compositions.yaml'));
      assert.ok(result[0].doc.compositions.memberSummary);
    } finally {
      removeTempDir(dir);
    }
  });

  test('discovers multiple composition files', () => {
    const dir = createTempDir();
    try {
      writeYaml(dir, 'intake-compositions.yaml', { ...minimalComposition, domain: 'intake' });
      writeYaml(dir, 'eligibility-compositions.yaml', { ...minimalComposition, domain: 'eligibility' });
      const result = discoverCompositions(dir);
      assert.equal(result.length, 2);
      const domains = result.map(r => r.domain).sort();
      assert.deepEqual(domains, ['eligibility', 'intake']);
    } finally {
      removeTempDir(dir);
    }
  });

  test('skips files without compositions key', () => {
    const dir = createTempDir();
    try {
      writeYaml(dir, 'test-compositions.yaml', { version: '1.0', domain: 'test' });
      const result = discoverCompositions(dir);
      assert.equal(result.length, 0);
    } finally {
      removeTempDir(dir);
    }
  });

  test('skips unparseable files', () => {
    const dir = createTempDir();
    try {
      writeFileSync(join(dir, 'broken-compositions.yaml'), ': invalid: yaml: !!: !!:', 'utf8');
      const result = discoverCompositions(dir);
      assert.equal(result.length, 0);
    } finally {
      removeTempDir(dir);
    }
  });

  test('applies state composition overlay from overlays/{state}/{domain}-compositions.yaml', () => {
    const dir = createTempDir();
    try {
      writeYaml(dir, 'intake-compositions.yaml', {
        version: '1.0',
        domain: 'intake',
        compositions: {
          reviewContext: {
            compositeType: 'sectionView',
            resource: 'applications',
            sections: {
              identity: { resource: 'members', bind: 'applicationId' },
            },
          },
        },
      });

      mkdirSync(join(dir, 'overlays', 'example'), { recursive: true });
      writeYaml(join(dir, 'overlays', 'example'), 'intake-compositions.yaml', {
        overlay: '1.0.0',
        info: { title: 'Example overlay', version: '1.0.0' },
        actions: [{
          target: '$.compositions.reviewContext.sections.household',
          description: 'Add household section',
          add: { resource: 'household-info', bind: 'applicationId' },
        }],
      });

      const result = discoverCompositions(dir);
      assert.equal(result.length, 1);
      assert.ok(result[0].doc.compositions.reviewContext.sections.household, 'overlay-added section present');
      assert.equal(result[0].doc.compositions.reviewContext.sections.identity.resource, 'members');
    } finally {
      removeTempDir(dir);
    }
  });

  test('skips overlay files without overlay: 1.0.0 header', () => {
    const dir = createTempDir();
    try {
      writeYaml(dir, 'intake-compositions.yaml', {
        version: '1.0',
        domain: 'intake',
        compositions: {
          reviewContext: { resource: 'applications', sections: { identity: {} } },
        },
      });

      mkdirSync(join(dir, 'overlays', 'example'), { recursive: true });
      writeYaml(join(dir, 'overlays', 'example'), 'intake-compositions.yaml', {
        version: '1.0',
        compositions: { extra: { resource: 'foo' } },
      });

      const result = discoverCompositions(dir);
      assert.equal(result.length, 1);
      assert.equal(result[0].doc.compositions.extra, undefined, 'non-overlay file should be ignored');
    } finally {
      removeTempDir(dir);
    }
  });

  test('applies overlays from multiple state directories', () => {
    const dir = createTempDir();
    try {
      writeYaml(dir, 'intake-compositions.yaml', {
        version: '1.0',
        domain: 'intake',
        compositions: {
          reviewContext: {
            compositeType: 'sectionView',
            resource: 'applications',
            sections: { identity: { resource: 'members', bind: 'applicationId' } },
          },
        },
      });

      mkdirSync(join(dir, 'overlays', 'state-a'), { recursive: true });
      writeYaml(join(dir, 'overlays', 'state-a'), 'intake-compositions.yaml', {
        overlay: '1.0.0',
        info: { title: 'State A overlay', version: '1.0.0' },
        actions: [{
          target: '$.compositions.reviewContext.sections.household',
          add: { resource: 'household-info', bind: 'applicationId' },
        }],
      });

      mkdirSync(join(dir, 'overlays', 'state-b'), { recursive: true });
      writeYaml(join(dir, 'overlays', 'state-b'), 'intake-compositions.yaml', {
        overlay: '1.0.0',
        info: { title: 'State B overlay', version: '1.0.0' },
        actions: [{
          target: '$.compositions.reviewContext.sections.expenses',
          add: { resource: 'member-expenses', bind: 'applicationId' },
        }],
      });

      const result = discoverCompositions(dir);
      assert.equal(result.length, 1);
      const sections = result[0].doc.compositions.reviewContext.sections;
      assert.ok(sections.identity, 'baseline section present');
      assert.ok(sections.household, 'state-a section present');
      assert.ok(sections.expenses, 'state-b section present');
    } finally {
      removeTempDir(dir);
    }
  });

  test('ignores overlays directory when it does not exist', () => {
    const dir = createTempDir();
    try {
      writeYaml(dir, 'intake-compositions.yaml', {
        version: '1.0',
        domain: 'intake',
        compositions: { reviewContext: { resource: 'applications', sections: {} } },
      });
      const result = discoverCompositions(dir);
      assert.equal(result.length, 1);
    } finally {
      removeTempDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// extractResourceSlug
// ---------------------------------------------------------------------------

describe('extractResourceSlug', () => {
  test('returns last non-param segment', () => {
    assert.equal(extractResourceSlug('/applications/{id}/member-incomes/{memberId}'), 'member-incomes');
  });

  test('handles top-level resource paths', () => {
    assert.equal(extractResourceSlug('/applications/{id}'), 'applications');
  });

  test('handles singleton paths without trailing param', () => {
    assert.equal(extractResourceSlug('/applications/{id}/household-info'), 'household-info');
  });

  test('returns null for param-only path', () => {
    assert.equal(extractResourceSlug('/{id}'), null);
  });
});

// ---------------------------------------------------------------------------
// collectSchemaProperties
// ---------------------------------------------------------------------------

describe('collectSchemaProperties', () => {
  test('collects flat properties', () => {
    const schema = {
      type: 'object',
      properties: { id: {}, name: {}, createdAt: {} }
    };
    const props = collectSchemaProperties(schema);
    assert.ok(props.has('id'));
    assert.ok(props.has('name'));
    assert.ok(props.has('createdAt'));
  });

  test('collects properties from allOf inline objects', () => {
    const schema = {
      allOf: [
        { $ref: './external.yaml' },
        { type: 'object', properties: { applicationId: {}, amount: {} } }
      ]
    };
    const props = collectSchemaProperties(schema);
    assert.ok(props.has('applicationId'));
    assert.ok(props.has('amount'));
  });

  test('skips $ref-only allOf members', () => {
    const schema = {
      allOf: [
        { $ref: './external.yaml' }
      ]
    };
    const props = collectSchemaProperties(schema);
    assert.equal(props.size, 0);
  });

  test('handles null/undefined gracefully', () => {
    assert.equal(collectSchemaProperties(null).size, 0);
    assert.equal(collectSchemaProperties(undefined).size, 0);
  });

  test('merges properties from both flat and allOf', () => {
    const schema = {
      properties: { id: {} },
      allOf: [
        { type: 'object', properties: { applicationId: {} } }
      ]
    };
    const props = collectSchemaProperties(schema);
    assert.ok(props.has('id'));
    assert.ok(props.has('applicationId'));
  });
});

// ---------------------------------------------------------------------------
// buildResourceSchemaIndex
// ---------------------------------------------------------------------------

describe('buildResourceSchemaIndex', () => {
  test('builds index from OpenAPI spec', () => {
    const yamlFiles = [{ relativePath: 'test-openapi.yaml', spec: sampleOpenApiSpec }];
    const index = buildResourceSchemaIndex(yamlFiles);

    assert.ok(index.has('member-incomes'));
    assert.ok(index.get('member-incomes').has('applicationId'));
    assert.ok(index.get('member-incomes').has('memberId'));
    assert.ok(index.get('member-incomes').has('amount'));
  });

  test('indexes household-info (singleton path)', () => {
    const yamlFiles = [{ relativePath: 'test-openapi.yaml', spec: sampleOpenApiSpec }];
    const index = buildResourceSchemaIndex(yamlFiles);

    assert.ok(index.has('household-info'));
    assert.ok(index.get('household-info').has('applicationId'));
    assert.ok(index.get('household-info').has('householdSize'));
  });

  test('indexes application-notes', () => {
    const yamlFiles = [{ relativePath: 'test-openapi.yaml', spec: sampleOpenApiSpec }];
    const index = buildResourceSchemaIndex(yamlFiles);

    assert.ok(index.has('notes'));
    assert.ok(index.get('notes').has('applicationId'));
  });

  test('returns empty map for files without paths', () => {
    const yamlFiles = [{ relativePath: 'no-paths.yaml', spec: { openapi: '3.1.0' } }];
    const index = buildResourceSchemaIndex(yamlFiles);
    assert.equal(index.size, 0);
  });

  test('ignores paths without GET operation', () => {
    const spec = {
      paths: {
        '/things/{id}': {
          post: { operationId: 'createThing', responses: {} }
        }
      },
      components: { schemas: {} }
    };
    const index = buildResourceSchemaIndex([{ relativePath: 'test.yaml', spec }]);
    assert.equal(index.size, 0);
  });

  test('ignores GET operations without a local schema ref', () => {
    const spec = {
      paths: {
        '/things/{id}': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { $ref: './external.yaml#/Thing' }
                  }
                }
              }
            }
          }
        }
      },
      components: { schemas: {} }
    };
    const index = buildResourceSchemaIndex([{ relativePath: 'test.yaml', spec }]);
    assert.equal(index.size, 0);
  });
});

// ---------------------------------------------------------------------------
// validateBindFields
// ---------------------------------------------------------------------------

describe('validateBindFields', () => {
  const yamlFiles = [{ relativePath: 'test-openapi.yaml', spec: sampleOpenApiSpec }];

  test('returns no errors when all bind fields are valid', () => {
    const compositionDoc = {
      domain: 'test',
      doc: {
        compositions: {
          ctx: {
            sections: {
              income: { resource: 'member-incomes', bind: 'applicationId' }
            }
          }
        }
      }
    };
    const index = buildResourceSchemaIndex(yamlFiles);
    const errors = validateBindFields(compositionDoc, index);
    assert.equal(errors.length, 0);
  });

  test('returns an error for an invalid bind field', () => {
    const compositionDoc = {
      domain: 'test',
      doc: {
        compositions: {
          ctx: {
            sections: {
              income: { resource: 'member-incomes', bind: 'nonExistentField' }
            }
          }
        }
      }
    };
    const index = buildResourceSchemaIndex(yamlFiles);
    const errors = validateBindFields(compositionDoc, index);
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes('nonExistentField'));
    assert.ok(errors[0].message.includes('member-incomes'));
  });

  test('validates bind fields in include nodes', () => {
    const compositionDoc = {
      domain: 'test',
      doc: {
        compositions: {
          ctx: {
            resource: 'applications',
            include: {
              notes: { resource: 'notes', bind: 'badField' }
            }
          }
        }
      }
    };
    const index = buildResourceSchemaIndex(yamlFiles);
    const errors = validateBindFields(compositionDoc, index);
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes('badField'));
    assert.ok(errors[0].path.includes('include.notes'));
  });

  test('validates bind fields in panel.include nodes', () => {
    const compositionDoc = {
      domain: 'test',
      doc: {
        compositions: {
          ctx: {
            panel: {
              include: {
                notes: { resource: 'notes', bind: 'badField' }
              }
            }
          }
        }
      }
    };
    const index = buildResourceSchemaIndex(yamlFiles);
    const errors = validateBindFields(compositionDoc, index);
    assert.equal(errors.length, 1);
    assert.ok(errors[0].path.includes('panel.include.notes'));
  });

  test('skips nodes whose resource is not in the index', () => {
    const compositionDoc = {
      domain: 'test',
      doc: {
        compositions: {
          ctx: {
            sections: {
              x: { resource: 'unknown-resource', bind: 'anyField' }
            }
          }
        }
      }
    };
    const index = buildResourceSchemaIndex(yamlFiles);
    const errors = validateBindFields(compositionDoc, index);
    assert.equal(errors.length, 0, 'should not error for resources not in the index');
  });

  test('supports compound bind arrays', () => {
    const compositionDoc = {
      domain: 'test',
      doc: {
        compositions: {
          ctx: {
            sections: {
              x: { resource: 'member-incomes', bind: ['applicationId', 'badCompoundField'] }
            }
          }
        }
      }
    };
    const index = buildResourceSchemaIndex(yamlFiles);
    const errors = validateBindFields(compositionDoc, index);
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes('badCompoundField'));
  });

  test('reports error path correctly for nested compositions', () => {
    const compositionDoc = {
      domain: 'intake',
      doc: {
        compositions: {
          reviewContext: {
            sections: {
              income: { resource: 'member-incomes', bind: 'badField' }
            }
          }
        }
      }
    };
    const index = buildResourceSchemaIndex(yamlFiles);
    const errors = validateBindFields(compositionDoc, index);
    assert.equal(errors.length, 1);
    assert.ok(errors[0].path.includes('intake.compositions.reviewContext.sections.income'));
  });
});

// ---------------------------------------------------------------------------
// validateSortableConfig
// ---------------------------------------------------------------------------

describe('validateSortableConfig', () => {
  function makeDoc(sectionOverrides) {
    return {
      domain: 'intake',
      doc: {
        compositions: {
          reviewContext: {
            sections: {
              income: { resource: 'member-incomes', bind: 'applicationId', ...sectionOverrides },
            },
          },
        },
      },
    };
  }

  test('returns no errors when sortable is absent', () => {
    const errors = validateSortableConfig(makeDoc({}));
    assert.equal(errors.length, 0);
  });

  test('returns no errors for valid field names', () => {
    const errors = validateSortableConfig(makeDoc({ sortable: { fields: ['amount', 'type', 'nested.field'] } }));
    assert.equal(errors.length, 0);
  });

  test('returns error for field name containing invalid characters', () => {
    const errors = validateSortableConfig(makeDoc({ sortable: { fields: ['amount', 'bad field!'] } }));
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes('bad field!'));
    assert.ok(errors[0].path.includes('income.sortable'));
  });

  test('returns error for invalid tieBreaker', () => {
    const errors = validateSortableConfig(makeDoc({ sortable: { fields: ['amount'], tieBreaker: 'bad-name' } }));
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.includes('bad-name'));
  });

  test('null tieBreaker is valid (disables tie-breaking)', () => {
    const errors = validateSortableConfig(makeDoc({ sortable: { fields: ['amount'], tieBreaker: null } }));
    assert.equal(errors.length, 0);
  });
});

// ---------------------------------------------------------------------------
// extractPathParams
// ---------------------------------------------------------------------------

describe('extractPathParams', () => {
  test('extracts single param', () => {
    assert.deepEqual(extractPathParams('/applications/{applicationId}/review'), ['applicationId']);
  });

  test('extracts multiple params', () => {
    assert.deepEqual(
      extractPathParams('/applications/{applicationId}/members/{memberId}'),
      ['applicationId', 'memberId']
    );
  });

  test('returns empty array for paths with no params', () => {
    assert.deepEqual(extractPathParams('/health'), []);
  });
});

// ---------------------------------------------------------------------------
// buildParameterIndex
// ---------------------------------------------------------------------------

describe('buildParameterIndex', () => {
  test('builds index from components.parameters', () => {
    const yamlFiles = [{ relativePath: 'test-openapi.yaml', spec: sampleOpenApiSpec }];
    const index = buildParameterIndex(yamlFiles);
    assert.ok(index.has('applicationId'));
    assert.equal(index.get('applicationId'), '#/components/parameters/ApplicationIdParam');
  });

  test('returns empty map when no parameters defined', () => {
    const yamlFiles = [{ relativePath: 'test.yaml', spec: { openapi: '3.1.0' } }];
    const index = buildParameterIndex(yamlFiles);
    assert.equal(index.size, 0);
  });

  test('first-writer wins across multiple files', () => {
    const spec1 = {
      components: {
        parameters: {
          ApplicationIdParam: { name: 'applicationId', in: 'path' }
        }
      }
    };
    const spec2 = {
      components: {
        parameters: {
          ApplicationIdParamV2: { name: 'applicationId', in: 'path' }
        }
      }
    };
    const index = buildParameterIndex([
      { relativePath: 'a.yaml', spec: spec1 },
      { relativePath: 'b.yaml', spec: spec2 }
    ]);
    assert.equal(index.get('applicationId'), '#/components/parameters/ApplicationIdParam');
  });
});

// ---------------------------------------------------------------------------
// generateCompositionOverlay
// ---------------------------------------------------------------------------

describe('generateCompositionOverlay', () => {
  function makeParamIndex() {
    return new Map([
      ['applicationId', '#/components/parameters/ApplicationIdParam']
    ]);
  }

  test('returns null when no compositions have endpoints', () => {
    const compositionFile = {
      domain: 'test',
      doc: {
        compositions: {
          noEndpoint: { resource: 'things', bind: 'parentId' }
        }
      }
    };
    const result = generateCompositionOverlay(compositionFile, makeParamIndex());
    assert.equal(result, null);
  });

  test('generates path and schema entries for a composition with an endpoint', () => {
    const compositionFile = {
      domain: 'test',
      doc: {
        compositions: {
          memberSummary: {
            resource: 'application-members',
            bind: 'applicationId',
            endpoint: {
              path: '/applications/{applicationId}/member-summary'
            }
          }
        }
      }
    };
    const overlay = generateCompositionOverlay(compositionFile, makeParamIndex());

    assert.ok(overlay);
    assert.equal(overlay.overlay, '1.0.0');

    const pathsAction = overlay.actions.find(a => a.target === '$.paths');
    assert.ok(pathsAction);
    const pathEntry = pathsAction.update['/applications/{applicationId}/member-summary'];
    assert.ok(pathEntry);
    assert.ok(pathEntry.get);
    assert.equal(pathEntry.get.operationId, 'getMemberSummary');

    // Parameter should be resolved to $ref
    assert.deepEqual(pathEntry.parameters, [
      { $ref: '#/components/parameters/ApplicationIdParam' }
    ]);
  });

  test('falls back to inline param when ref not found', () => {
    const compositionFile = {
      domain: 'test',
      doc: {
        compositions: {
          ctx: {
            resource: 'things',
            endpoint: { path: '/domains/{domainId}/ctx' }
          }
        }
      }
    };
    const emptyParamIndex = new Map();
    const overlay = generateCompositionOverlay(compositionFile, emptyParamIndex);

    const pathsAction = overlay.actions.find(a => a.target === '$.paths');
    const pathEntry = pathsAction.update['/domains/{domainId}/ctx'];
    assert.deepEqual(pathEntry.parameters, [
      { name: 'domainId', in: 'path', required: true, schema: { type: 'string' } }
    ]);
  });

  test('generates a stub response schema', () => {
    const compositionFile = {
      domain: 'test',
      doc: {
        compositions: {
          memberSummary: {
            resource: 'application-members',
            endpoint: { path: '/applications/{applicationId}/member-summary' }
          }
        }
      }
    };
    const overlay = generateCompositionOverlay(compositionFile, makeParamIndex());
    const schemasAction = overlay.actions.find(a => a.target === '$.components.schemas');
    assert.ok(schemasAction);
    assert.ok(schemasAction.update.MemberSummaryResponse);
  });

  test('targets the correct domain OpenAPI file', () => {
    const compositionFile = {
      domain: 'intake',
      doc: {
        compositions: {
          ctx: {
            resource: 'applications',
            endpoint: { path: '/applications/{applicationId}/ctx' }
          }
        }
      }
    };
    const overlay = generateCompositionOverlay(compositionFile, makeParamIndex());
    for (const action of overlay.actions) {
      assert.equal(action.file, 'intake-openapi.yaml');
    }
  });

  test('handles no path params', () => {
    const compositionFile = {
      domain: 'test',
      doc: {
        compositions: {
          global: {
            resource: 'things',
            endpoint: { path: '/global-summary' }
          }
        }
      }
    };
    const overlay = generateCompositionOverlay(compositionFile, new Map());
    const pathsAction = overlay.actions.find(a => a.target === '$.paths');
    const pathEntry = pathsAction.update['/global-summary'];
    assert.equal(pathEntry.parameters, undefined);
  });
});

// ---------------------------------------------------------------------------
// generateCompositionOverlays (integration)
// ---------------------------------------------------------------------------

describe('generateCompositionOverlays', () => {
  test('generates one overlay per composition file with endpoints', () => {
    const dir = createTempDir();
    try {
      writeYaml(dir, 'intake-compositions.yaml', sectionViewComposition);

      const compositionFiles = discoverCompositions(dir);
      const yamlFiles = [{ relativePath: 'intake-openapi.yaml', spec: sampleOpenApiSpec }];
      const overlays = generateCompositionOverlays(compositionFiles, yamlFiles);

      assert.equal(overlays.length, 1);
      assert.equal(overlays[0].domain, 'intake');
    } finally {
      removeTempDir(dir);
    }
  });

  test('uses parameter refs from the loaded spec', () => {
    const dir = createTempDir();
    try {
      writeYaml(dir, 'intake-compositions.yaml', sectionViewComposition);

      const compositionFiles = discoverCompositions(dir);
      const yamlFiles = [{ relativePath: 'intake-openapi.yaml', spec: sampleOpenApiSpec }];
      const overlays = generateCompositionOverlays(compositionFiles, yamlFiles);

      const { overlay } = overlays[0];
      const pathsAction = overlay.actions.find(a => a.target === '$.paths');
      const pathEntry = pathsAction.update['/applications/{applicationId}/review'];
      assert.ok(pathEntry.parameters.some(p => p.$ref === '#/components/parameters/ApplicationIdParam'));
    } finally {
      removeTempDir(dir);
    }
  });

  test('skips composition files with no endpoint declarations', () => {
    const dir = createTempDir();
    try {
      writeYaml(dir, 'test-compositions.yaml', {
        version: '1.0',
        domain: 'test',
        compositions: {
          ctx: { resource: 'things', bind: 'parentId' }
        }
      });

      const compositionFiles = discoverCompositions(dir);
      const overlays = generateCompositionOverlays(compositionFiles, []);
      assert.equal(overlays.length, 0);
    } finally {
      removeTempDir(dir);
    }
  });
});

// ---------------------------------------------------------------------------
// generateSectionViewPanelEndpoints
// ---------------------------------------------------------------------------

describe('generateSectionViewPanelEndpoints', () => {
  function makeParamIndex() {
    return new Map([
      ['applicationId', '#/components/parameters/ApplicationIdParam']
    ]);
  }

  const sections = {
    income: { resource: 'member-incomes', bind: 'applicationId' },
    contact: { resource: 'contacts', bind: 'applicationId' },
  };

  test('returns one path per section (static paths, no {section} param)', () => {
    const result = generateSectionViewPanelEndpoints('reviewContext', '/applications/{applicationId}/review', sections, makeParamIndex());
    const paths = Object.keys(result.paths);
    assert.equal(paths.length, 2);
    assert.ok(result.paths['/applications/{applicationId}/review/income'], 'income path present');
    assert.ok(result.paths['/applications/{applicationId}/review/contact'], 'contact path present');
    assert.ok(!paths.some(p => p.includes('{section}')), 'no {section} param in any path');
  });

  test('each path entry has parent path params (no section path param)', () => {
    const result = generateSectionViewPanelEndpoints('reviewContext', '/applications/{applicationId}/review', sections, makeParamIndex());
    for (const pathEntry of Object.values(result.paths)) {
      assert.ok(pathEntry.parameters.some(p => p.$ref === '#/components/parameters/ApplicationIdParam'), 'has parent param ref');
      assert.ok(!pathEntry.parameters.some(p => p.name === 'section'), 'no section path param');
    }
  });

  test('each GET operation has standard query params (SearchQueryParam, LimitParam, OffsetParam, SortParam)', () => {
    const result = generateSectionViewPanelEndpoints('reviewContext', '/applications/{applicationId}/review', sections, makeParamIndex());
    for (const pathEntry of Object.values(result.paths)) {
      const params = pathEntry.get.parameters;
      assert.ok(params.some(p => p.$ref === './components/parameters.yaml#/SearchQueryParam'), 'has SearchQueryParam');
      assert.ok(params.some(p => p.$ref === './components/parameters.yaml#/LimitParam'), 'has LimitParam');
      assert.ok(params.some(p => p.$ref === './components/parameters.yaml#/OffsetParam'), 'has OffsetParam');
      assert.ok(params.some(p => p.$ref === './components/parameters.yaml#/SortParam'), 'has SortParam');
    }
  });

  test('operationId follows get{Composition}{Section}Section pattern', () => {
    const result = generateSectionViewPanelEndpoints('reviewContext', '/applications/{applicationId}/review', sections, makeParamIndex());
    assert.equal(result.paths['/applications/{applicationId}/review/income'].get.operationId, 'getReviewContextIncomeSection');
    assert.equal(result.paths['/applications/{applicationId}/review/contact'].get.operationId, 'getReviewContextContactSection');
  });

  test('schema name is {CompositionName}SectionResponse (shared across sections)', () => {
    const result = generateSectionViewPanelEndpoints('reviewContext', '/applications/{applicationId}/review', sections, makeParamIndex());
    assert.equal(result.schemaName, 'ReviewContextSectionResponse');
  });

  test('section with sortable config gets x-sortable on its GET operation', () => {
    const sectionsWithSortable = {
      income: {
        resource: 'member-incomes',
        bind: 'applicationId',
        sortable: { fields: ['amount', 'type'], default: 'amount', tieBreaker: 'id' },
      },
      contact: { resource: 'contacts', bind: 'applicationId' },
    };
    const result = generateSectionViewPanelEndpoints('reviewContext', '/applications/{applicationId}/review', sectionsWithSortable, makeParamIndex());
    const incomeGet = result.paths['/applications/{applicationId}/review/income'].get;
    assert.ok(incomeGet['x-sortable'], 'income section has x-sortable');
    assert.deepEqual(incomeGet['x-sortable'].fields, ['amount', 'type']);
    assert.equal(incomeGet['x-sortable'].default, 'amount');
    assert.equal(incomeGet['x-sortable'].tieBreaker, 'id');

    const contactGet = result.paths['/applications/{applicationId}/review/contact'].get;
    assert.equal(contactGet['x-sortable'], undefined, 'contact section has no x-sortable');
  });

  test('sortable config without default or tieBreaker omits those fields', () => {
    const sectionsWithMinimalSortable = {
      income: {
        resource: 'member-incomes',
        bind: 'applicationId',
        sortable: { fields: ['amount'] },
      },
    };
    const result = generateSectionViewPanelEndpoints('reviewContext', '/applications/{applicationId}/review', sectionsWithMinimalSortable, makeParamIndex());
    const xSortable = result.paths['/applications/{applicationId}/review/income'].get['x-sortable'];
    assert.ok(xSortable);
    assert.deepEqual(xSortable.fields, ['amount']);
    assert.equal(xSortable.default, undefined);
    assert.equal(xSortable.tieBreaker, undefined);
  });

  test('falls back to inline param when parent path param not in index', () => {
    const result = generateSectionViewPanelEndpoints('myCtx', '/domains/{domainId}/ctx', { info: {} }, new Map());
    const pathEntry = result.paths['/domains/{domainId}/ctx/info'];
    assert.ok(pathEntry, 'path exists');
    const domainParam = pathEntry.parameters.find(p => p.name === 'domainId');
    assert.ok(domainParam, 'inline param for unknown parent param');
    assert.equal(domainParam.in, 'path');
  });

  test('GET 404 response uses shared ref', () => {
    const result = generateSectionViewPanelEndpoints('reviewContext', '/applications/{applicationId}/review', sections, makeParamIndex());
    for (const pathEntry of Object.values(result.paths)) {
      assert.equal(pathEntry.get.responses['404'].$ref, './components/responses.yaml#/NotFound');
    }
  });

  test('returns empty paths object when sections is empty', () => {
    const result = generateSectionViewPanelEndpoints('reviewContext', '/applications/{applicationId}/review', {}, makeParamIndex());
    assert.deepEqual(result.paths, {});
  });
});

// ---------------------------------------------------------------------------
// generateCompositionOverlay — sectionView panel endpoint
// ---------------------------------------------------------------------------

describe('generateCompositionOverlay — sectionView panel', () => {
  function makeParamIndex() {
    return new Map([['applicationId', '#/components/parameters/ApplicationIdParam']]);
  }

  test('sectionView emits one static path per section in addition to index path', () => {
    const compositionFile = {
      domain: 'intake',
      doc: {
        compositions: {
          reviewContext: {
            compositeType: 'sectionView',
            resource: 'applications',
            endpoint: { path: '/applications/{applicationId}/review' },
            sections: {
              income: { resource: 'member-incomes', bind: 'applicationId' },
              contact: { resource: 'contacts', bind: 'applicationId' },
            }
          }
        }
      }
    };
    const overlay = generateCompositionOverlay(compositionFile, makeParamIndex());
    const pathsAction = overlay.actions.find(a => a.target === '$.paths');
    assert.ok(pathsAction.update['/applications/{applicationId}/review'], 'index path present');
    assert.ok(pathsAction.update['/applications/{applicationId}/review/income'], 'income panel path present');
    assert.ok(pathsAction.update['/applications/{applicationId}/review/contact'], 'contact panel path present');
    assert.ok(!Object.keys(pathsAction.update).some(p => p.includes('{section}')), 'no {section} param in any path');
  });

  test('non-sectionView composition does not emit panel paths', () => {
    const compositionFile = {
      domain: 'test',
      doc: {
        compositions: {
          memberSummary: {
            resource: 'application-members',
            endpoint: { path: '/applications/{applicationId}/member-summary' }
          }
        }
      }
    };
    const overlay = generateCompositionOverlay(compositionFile, makeParamIndex());
    const pathsAction = overlay.actions.find(a => a.target === '$.paths');
    const paths = Object.keys(pathsAction.update);
    assert.equal(paths.length, 1, 'only index path for non-sectionView');
    assert.ok(!paths.some(p => p.includes('{section}')), 'no panel path for non-sectionView');
  });

  test('sectionView emits panel schema alongside index schema', () => {
    const compositionFile = {
      domain: 'intake',
      doc: {
        compositions: {
          reviewContext: {
            compositeType: 'sectionView',
            resource: 'applications',
            endpoint: { path: '/applications/{applicationId}/review' },
            sections: { income: { resource: 'member-incomes', bind: 'applicationId' } }
          }
        }
      }
    };
    const overlay = generateCompositionOverlay(compositionFile, makeParamIndex());
    const schemasAction = overlay.actions.find(a => a.target === '$.components.schemas');
    assert.ok(schemasAction.update.ReviewContextResponse, 'index schema present');
    assert.ok(schemasAction.update.ReviewContextSectionResponse, 'panel schema present');
  });

  test('sectionView emits section enum schema in the overlay', () => {
    const compositionFile = {
      domain: 'intake',
      doc: {
        compositions: {
          reviewContext: {
            compositeType: 'sectionView',
            resource: 'applications',
            endpoint: { path: '/applications/{applicationId}/review' },
            sections: { demographics: {}, identity: {}, income: {} }
          }
        }
      }
    };
    const overlay = generateCompositionOverlay(compositionFile, makeParamIndex());
    const schemasAction = overlay.actions.find(a => a.target === '$.components.schemas');
    const enumSchema = schemasAction.update.ReviewContextSections;
    assert.ok(enumSchema, 'section enum schema present');
    assert.deepEqual(enumSchema.enum, ['demographics', 'identity', 'income']);
    assert.equal(enumSchema['x-generated'], 'section-enum');
  });

  test('sectionView with no sections does not emit section enum', () => {
    const compositionFile = {
      domain: 'intake',
      doc: {
        compositions: {
          reviewContext: {
            compositeType: 'sectionView',
            resource: 'applications',
            endpoint: { path: '/applications/{applicationId}/review' },
            sections: {}
          }
        }
      }
    };
    const overlay = generateCompositionOverlay(compositionFile, makeParamIndex());
    const schemasAction = overlay.actions.find(a => a.target === '$.components.schemas');
    assert.ok(!schemasAction.update.ReviewContextSections, 'no enum schema for empty sections');
  });

  test('non-sectionView composition does not emit section enum', () => {
    const compositionFile = {
      domain: 'intake',
      doc: {
        compositions: {
          memberSummary: {
            resource: 'application-members',
            endpoint: { path: '/applications/{applicationId}/member-summary' }
          }
        }
      }
    };
    const overlay = generateCompositionOverlay(compositionFile, makeParamIndex());
    const schemasAction = overlay.actions.find(a => a.target === '$.components.schemas');
    const keys = Object.keys(schemasAction.update);
    assert.ok(!keys.some(k => k.endsWith('Sections')), 'no enum schema for non-sectionView');
  });
});

// ---------------------------------------------------------------------------
// Real intake composition round-trip
// ---------------------------------------------------------------------------

describe('real intake composition', () => {
  test('discoverCompositions finds intake-compositions.yaml', () => {
    const specsDir = join(__dirname, '../../');
    const compositions = discoverCompositions(specsDir);
    const intake = compositions.find(c => c.domain === 'intake');
    assert.ok(intake, 'should discover intake-compositions.yaml');
    assert.ok(intake.doc.compositions.applicationReview, 'should have applicationReview');
  });

  test('validateBindFields finds no errors against real intake spec', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');

    const specsDir = join(__dirname, '../../');
    const compositions = discoverCompositions(specsDir);
    const intake = compositions.find(c => c.domain === 'intake');
    assert.ok(intake, 'intake compositions must be discoverable');

    const specPath = resolve(specsDir, 'intake-openapi.yaml');
    const spec = yaml.load(readFileSync(specPath, 'utf8'));
    const yamlFiles = [{ relativePath: 'intake-openapi.yaml', spec }];

    const index = buildResourceSchemaIndex(yamlFiles);
    const errors = validateBindFields(intake, index);

    if (errors.length > 0) {
      for (const e of errors) {
        console.error(`  Bind error: ${e.message} at ${e.path}`);
      }
    }
    assert.equal(errors.length, 0, 'no bind validation errors expected for real intake compositions');
  });
});

// ---------------------------------------------------------------------------
// buildPathToSchemaMap
// ---------------------------------------------------------------------------

describe('buildPathToSchemaMap', () => {
  const specWithPaths = {
    paths: {
      '/applications/{applicationId}': {
        get: {
          responses: {
            '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Application' } } } }
          }
        }
      },
      '/applications': {
        get: {
          responses: {
            '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationListResponse' } } } }
          }
        }
      }
    },
    components: {
      schemas: {
        Application: {
          allOf: [
            { $ref: '#/components/schemas/ApplicationWritable' },
            { type: 'object', properties: { id: { type: 'string' } } }
          ]
        },
        ApplicationListResponse: {
          type: 'object',
          properties: { items: { type: 'array' } }
        }
      }
    }
  };

  test('maps path to schema name', () => {
    const map = buildPathToSchemaMap([{ relativePath: 'intake-openapi.yaml', spec: specWithPaths }]);
    assert.ok(map.has('/applications/{applicationId}'));
    assert.equal(map.get('/applications/{applicationId}').schemaName, 'Application');
  });

  test('detects hasAllOf correctly', () => {
    const map = buildPathToSchemaMap([{ relativePath: 'intake-openapi.yaml', spec: specWithPaths }]);
    assert.equal(map.get('/applications/{applicationId}').hasAllOf, true);
    assert.equal(map.get('/applications').hasAllOf, false);
  });

  test('skips paths with no GET response schema $ref', () => {
    const spec = {
      paths: {
        '/things/{id}': { get: { responses: { '200': { content: { 'application/json': { schema: { type: 'object' } } } } } } }
      },
      components: { schemas: {} }
    };
    const map = buildPathToSchemaMap([{ relativePath: 'test.yaml', spec }]);
    assert.equal(map.size, 0);
  });

  test('returns empty map for specs with no paths', () => {
    const map = buildPathToSchemaMap([{ relativePath: 'empty.yaml', spec: {} }]);
    assert.equal(map.size, 0);
  });
});

// ---------------------------------------------------------------------------
// parentLink overlay injection
// ---------------------------------------------------------------------------

describe('parentLink overlay injection', () => {
  const specWithApplication = {
    paths: {
      '/applications/{applicationId}': {
        get: {
          responses: {
            '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Application' } } } }
          }
        }
      }
    },
    components: {
      schemas: {
        Application: {
          allOf: [
            { $ref: '#/components/schemas/ApplicationWritable' },
            { type: 'object', properties: { id: { type: 'string' } } }
          ]
        }
      }
    }
  };

  const parentSchemaMap = buildPathToSchemaMap([{ relativePath: 'intake-openapi.yaml', spec: specWithApplication }]);

  const compositionFile = {
    domain: 'intake',
    filePath: '/tmp/intake-compositions.yaml',
    doc: {
      compositions: {
        reviewContext: {
          compositeType: 'sectionView',
          resource: 'applications',
          endpoint: {
            path: '/applications/{applicationId}/review',
            parentLink: true,
          },
          sections: { demographics: { resource: 'application-members', bind: 'applicationId' } },
        }
      }
    }
  };

  test('emits an append action targeting Application.allOf', () => {
    const overlay = generateCompositionOverlay(compositionFile, new Map(), parentSchemaMap);
    assert.ok(overlay, 'overlay should be generated');
    const appendAction = overlay.actions.find(a =>
      a.target === '$.components.schemas.Application.allOf' && a.append
    );
    assert.ok(appendAction, 'should have append action for Application.allOf');
    assert.equal(appendAction.file, 'intake-openapi.yaml');
    assert.ok(appendAction.append.properties._links, '_links property should be present');
    assert.ok(
      appendAction.append.properties._links.properties.reviewContext,
      '_links.reviewContext should be present'
    );
  });

  test('emits update action on properties for non-allOf parent schemas', () => {
    const plainSpec = {
      paths: {
        '/things/{thingId}': {
          get: {
            responses: {
              '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } } }
            }
          }
        }
      },
      components: {
        schemas: {
          Thing: { type: 'object', properties: { id: { type: 'string' } } }
        }
      }
    };
    const plainParentSchemaMap = buildPathToSchemaMap([{ relativePath: 'test-openapi.yaml', spec: plainSpec }]);
    const plainCompositionFile = {
      domain: 'test',
      filePath: '/tmp/test-compositions.yaml',
      doc: {
        compositions: {
          thingView: {
            resource: 'things',
            endpoint: {
              path: '/things/{thingId}/view',
              parentLink: true,
            }
          }
        }
      }
    };
    const overlay = generateCompositionOverlay(plainCompositionFile, new Map(), plainParentSchemaMap);
    const updateAction = overlay.actions.find(a =>
      a.target === '$.components.schemas.Thing.properties' && a.update
    );
    assert.ok(updateAction, 'should have update action for Thing.properties');
    assert.ok(updateAction.update._links, '_links should be in update');
  });

  test('emits no extra actions when parentSchemaMap is not provided', () => {
    const overlay = generateCompositionOverlay(compositionFile, new Map());
    const appendActions = overlay.actions.filter(a => a.append);
    assert.equal(appendActions.length, 0, 'no append actions without parentSchemaMap');
  });

  test('emits no extra actions when parent path not found in map', () => {
    const emptyMap = new Map();
    const overlay = generateCompositionOverlay(compositionFile, new Map(), emptyMap);
    const appendActions = overlay.actions.filter(a => a.append);
    assert.equal(appendActions.length, 0, 'no append actions when parent not in map');
  });
});

// ---------------------------------------------------------------------------
// generateStateSchemas
// ---------------------------------------------------------------------------

describe('generateStateSchemas', () => {
  test('returns empty object when stateConfig is null', () => {
    assert.deepEqual(generateStateSchemas(null), {});
  });

  test('returns empty object when stateConfig has no schema.name', () => {
    assert.deepEqual(generateStateSchemas({ schema: { properties: { foo: { type: 'string' } } } }), {});
  });

  test('generates three schemas from state config with name', () => {
    const state = { schema: { name: 'ReviewProgress' } };
    const schemas = generateStateSchemas(state);
    assert.ok('ReviewProgressWritable' in schemas, 'Writable schema present');
    assert.ok('ReviewProgress' in schemas, 'resource schema present');
    assert.ok('ReviewProgressListResponse' in schemas, 'ListResponse schema present');
  });

  test('writable schema includes user-defined properties', () => {
    const state = {
      schema: {
        name: 'ReviewProgress',
        properties: {
          status: { type: 'string', enum: ['not_started', 'complete'] },
          notes: { type: 'string' },
        },
      },
    };
    const schemas = generateStateSchemas(state);
    const writable = schemas.ReviewProgressWritable;
    assert.ok(writable.properties?.status, 'status property present');
    assert.ok(writable.properties?.notes, 'notes property present');
  });

  test('writable schema omits properties key when schema has no properties', () => {
    const state = { schema: { name: 'ReviewProgress' } };
    const schemas = generateStateSchemas(state);
    assert.ok(!schemas.ReviewProgressWritable.properties, 'no properties key when none defined');
  });

  test('writable schema includes required when declared', () => {
    const state = {
      schema: {
        name: 'ReviewProgress',
        properties: { status: { type: 'string' } },
        required: ['status'],
      },
    };
    const schemas = generateStateSchemas(state);
    assert.deepEqual(schemas.ReviewProgressWritable.required, ['status']);
  });

  test('resource schema uses allOf referencing writable schema', () => {
    const state = { schema: { name: 'ReviewProgress' } };
    const schemas = generateStateSchemas(state);
    const resource = schemas.ReviewProgress;
    assert.ok(Array.isArray(resource.allOf), 'resource schema uses allOf');
    const ref = resource.allOf.find(e => e.$ref);
    assert.equal(ref?.$ref, '#/components/schemas/ReviewProgressWritable');
  });

  test('list response schema references the resource schema', () => {
    const state = { schema: { name: 'ReviewProgress' } };
    const schemas = generateStateSchemas(state);
    const list = schemas.ReviewProgressListResponse;
    assert.equal(list.properties.items.items.$ref, '#/components/schemas/ReviewProgress');
  });
});

// ---------------------------------------------------------------------------
// Overlay-then-generate: state.schema properties from composition overlay
// ---------------------------------------------------------------------------

describe('overlay-then-generate: state schema picks up composition YAML overlay properties', () => {
  let tmpDir;

  function makeCompositionFixture(dir) {
    // Overlays are discovered from overlays/{stateDir}/{domain}-compositions.yaml
    const stateOverlayDir = join(dir, 'overlays', 'mystate');
    mkdirSync(stateOverlayDir, { recursive: true });

    const baseComposition = {
      version: '1.0',
      domain: 'test',
      compositions: {
        appReview: {
          compositeType: 'sectionView',
          resource: 'applications',
          endpoint: { path: '/applications/{applicationId}/review' },
          sections: {},
          state: {
            resource: 'application-review-progress',
            bind: 'applicationId',
            schema: {
              name: 'ReviewProgress',
              properties: {
                status: { type: 'string', enum: ['not_started', 'complete'] },
              },
            },
          },
        },
      },
    };
    writeYaml(dir, 'test-compositions.yaml', baseComposition);

    // Composition YAML overlay adds a field to state.schema.properties
    const stateOverlay = {
      overlay: '1.0.0',
      info: { title: 'State extension overlay', version: '1.0.0' },
      actions: [{
        target: '$.compositions.appReview.state.schema.properties',
        update: { notes: { type: 'string' } },
      }],
    };
    writeYaml(stateOverlayDir, 'test-compositions.yaml', stateOverlay);
  }

  test('properties added via compositions YAML overlay appear in generated {Name}Writable', () => {
    tmpDir = createTempDir();
    try {
      makeCompositionFixture(tmpDir);

      const compositions = discoverCompositions(tmpDir);
      const found = compositions.find(c => c.domain === 'test');
      assert.ok(found, 'composition discovered');

      const mergedState = found.doc.compositions.appReview.state;
      assert.ok(mergedState.schema.properties?.notes, 'overlay added notes property to state schema');

      // generateStateSchemas must pick up the overlaid property
      const schemas = generateStateSchemas(mergedState);
      assert.ok(schemas.ReviewProgressWritable.properties?.notes, 'notes appears in generated ReviewProgressWritable');
      assert.ok(schemas.ReviewProgressWritable.properties?.status, 'baseline status still present');
    } finally {
      removeTempDir(tmpDir);
    }
  });

  test('overlaid state schema property appears in the generated OpenAPI overlay schemas action', () => {
    tmpDir = createTempDir();
    try {
      makeCompositionFixture(tmpDir);

      const compositions = discoverCompositions(tmpDir);

      // Simulate what the resolve pipeline passes as yamlFiles
      const yamlFiles = [{ relativePath: 'test-openapi.yaml', spec: { paths: {}, components: { schemas: {} } } }];
      const compositionOverlays = generateCompositionOverlays(compositions, yamlFiles);

      const testOverlay = compositionOverlays.find(o => o.domain === 'test');
      assert.ok(testOverlay, 'overlay generated for test domain');

      const schemasAction = testOverlay.overlay.actions.find(a => a.target === '$.components.schemas');
      assert.ok(schemasAction, 'schemas action present');

      const writableSchema = schemasAction.update?.ReviewProgressWritable;
      assert.ok(writableSchema, 'ReviewProgressWritable in generated overlay');
      assert.ok(writableSchema.properties?.notes, 'notes property (from composition overlay) in ReviewProgressWritable');
      assert.ok(writableSchema.properties?.status, 'baseline status property still in ReviewProgressWritable');
    } finally {
      removeTempDir(tmpDir);
    }
  });
});
