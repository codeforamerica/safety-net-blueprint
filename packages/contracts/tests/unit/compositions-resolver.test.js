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
  extractPathParams,
  buildParameterIndex,
  generateCompositionOverlay,
  generateCompositionOverlays
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
    assert.ok(pathEntry.get['x-composition']);

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
    assert.equal(schemasAction.update.MemberSummaryResponse['x-composition'], 'memberSummary');
  });

  test('includes x-composition-type for sectionView', () => {
    const compositionFile = {
      domain: 'intake',
      doc: {
        compositions: {
          reviewContext: {
            compositeType: 'sectionView',
            resource: 'applications',
            endpoint: { path: '/applications/{applicationId}/review' }
          }
        }
      }
    };
    const overlay = generateCompositionOverlay(compositionFile, makeParamIndex());
    const schemasAction = overlay.actions.find(a => a.target === '$.components.schemas');
    const schema = schemasAction.update.ReviewContextResponse;
    assert.equal(schema['x-composition-type'], 'sectionView');
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
// Real intake composition round-trip
// ---------------------------------------------------------------------------

describe('real intake composition', () => {
  test('discoverCompositions finds intake-compositions.yaml', () => {
    const specsDir = join(__dirname, '../../');
    const compositions = discoverCompositions(specsDir);
    const intake = compositions.find(c => c.domain === 'intake');
    assert.ok(intake, 'should discover intake-compositions.yaml');
    assert.ok(intake.doc.compositions.reviewContext, 'should have reviewContext');
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
