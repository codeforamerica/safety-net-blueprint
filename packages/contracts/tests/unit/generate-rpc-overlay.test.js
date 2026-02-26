/**
 * Unit tests for the RPC overlay generator
 * Tests overlay generation from state machine contracts
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import yaml from 'js-yaml';
import {
  discoverStateMachines,
  extractItemEndpoint,
  generateOverlay,
  buildOperationId
} from '../../scripts/generate-rpc-overlay.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function createTempDir() {
  const tmpDir = join(__dirname, `tmp-rpc-overlay-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

function removeTempDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore
  }
}

// Sample state machine for testing
const sampleStateMachine = {
  domain: 'workflow',
  object: 'Task',
  apiSpec: 'workflow-openapi.yaml',
  states: { pending: {}, in_progress: {}, completed: {} },
  initialState: 'pending',
  guards: {
    taskIsUnassigned: { field: 'assignedToId', operator: 'is_null' },
    callerIsAssignedWorker: { field: 'assignedToId', operator: 'equals', value: '$caller.id' }
  },
  transitions: [
    { trigger: 'claim', from: 'pending', to: 'in_progress', guards: ['taskIsUnassigned'], effects: [{ type: 'set', field: 'assignedToId', value: '$caller.id' }] },
    { trigger: 'complete', from: 'in_progress', to: 'completed', guards: ['callerIsAssignedWorker'], effects: [] },
    { trigger: 'release', from: 'in_progress', to: 'pending', guards: ['callerIsAssignedWorker'], effects: [{ type: 'set', field: 'assignedToId', value: null }] }
  ],
  requestBodies: {
    claim: {},
    complete: {
      type: 'object',
      properties: {
        outcome: { type: 'string', description: 'Completion outcome' }
      },
      required: ['outcome']
    },
    release: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why the task is being released' }
      },
      required: ['reason']
    }
  }
};

const sampleEndpointInfo = {
  itemPath: '/tasks/{taskId}',
  paramRefs: [{ $ref: '#/components/parameters/TaskIdParam' }],
  tag: 'Tasks',
  schemaRef: '#/components/schemas/Task'
};

// =============================================================================
// buildOperationId
// =============================================================================

test('buildOperationId — creates correct operation ID', () => {
  assert.strictEqual(buildOperationId('claim', 'Task'), 'claimTask');
  assert.strictEqual(buildOperationId('complete', 'Task'), 'completeTask');
  assert.strictEqual(buildOperationId('release', 'Task'), 'releaseTask');
});

// =============================================================================
// discoverStateMachines
// =============================================================================

test('discoverStateMachines — finds state machine files', () => {
  const tmpDir = createTempDir();
  try {
    writeFileSync(join(tmpDir, 'workflow-state-machine.yaml'),
      yaml.dump(sampleStateMachine), 'utf8');

    const results = discoverStateMachines(tmpDir);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].stateMachine.domain, 'workflow');
  } finally {
    removeTempDir(tmpDir);
  }
});

test('discoverStateMachines — returns empty for no matches', () => {
  const tmpDir = createTempDir();
  try {
    writeFileSync(join(tmpDir, 'not-a-state-machine.yaml'), 'foo: bar', 'utf8');
    const results = discoverStateMachines(tmpDir);
    assert.strictEqual(results.length, 0);
  } finally {
    removeTempDir(tmpDir);
  }
});

// =============================================================================
// extractItemEndpoint
// =============================================================================

test('extractItemEndpoint — extracts path and params from API spec', () => {
  const tmpDir = createTempDir();
  try {
    const spec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/test/items': {
          get: { summary: 'List items', tags: ['Items'] }
        },
        '/test/items/{itemId}': {
          parameters: [{ $ref: '#/components/parameters/ItemIdParam' }],
          get: {
            summary: 'Get item',
            tags: ['Items'],
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Item' }
                  }
                }
              }
            }
          }
        }
      }
    };
    writeFileSync(join(tmpDir, 'test-openapi.yaml'), yaml.dump(spec), 'utf8');

    const result = extractItemEndpoint(tmpDir, 'test-openapi.yaml');
    assert.ok(result);
    assert.strictEqual(result.itemPath, '/test/items/{itemId}');
    assert.strictEqual(result.paramRefs.length, 1);
    assert.strictEqual(result.paramRefs[0].$ref, '#/components/parameters/ItemIdParam');
    assert.strictEqual(result.tag, 'Items');
    assert.strictEqual(result.schemaRef, '#/components/schemas/Item');
  } finally {
    removeTempDir(tmpDir);
  }
});

test('extractItemEndpoint — returns null for missing file', () => {
  const result = extractItemEndpoint('/nonexistent', 'missing.yaml');
  assert.strictEqual(result, null);
});

test('extractItemEndpoint — returns null for spec without item paths', () => {
  const tmpDir = createTempDir();
  try {
    const spec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/test/items': { get: { summary: 'List items' } }
      }
    };
    writeFileSync(join(tmpDir, 'test-openapi.yaml'), yaml.dump(spec), 'utf8');

    const result = extractItemEndpoint(tmpDir, 'test-openapi.yaml');
    assert.strictEqual(result, null);
  } finally {
    removeTempDir(tmpDir);
  }
});

// =============================================================================
// generateOverlay
// =============================================================================

test('generateOverlay — creates valid overlay structure', () => {
  const overlay = generateOverlay(sampleStateMachine, sampleEndpointInfo);

  assert.strictEqual(overlay.overlay, '1.0.0');
  assert.ok(overlay.info.title.includes('workflow'));
  assert.ok(overlay.info.description.includes('workflow-state-machine.yaml'));
  assert.strictEqual(overlay.actions.length, 1);
  assert.strictEqual(overlay.actions[0].target, '$.paths');
});

test('generateOverlay — creates one path per transition', () => {
  const overlay = generateOverlay(sampleStateMachine, sampleEndpointInfo);
  const paths = overlay.actions[0].update;

  assert.ok(paths['/tasks/{taskId}/claim']);
  assert.ok(paths['/tasks/{taskId}/complete']);
  assert.ok(paths['/tasks/{taskId}/release']);
  assert.strictEqual(Object.keys(paths).length, 3);
});

test('generateOverlay — each path has POST operation', () => {
  const overlay = generateOverlay(sampleStateMachine, sampleEndpointInfo);
  const paths = overlay.actions[0].update;

  for (const pathItem of Object.values(paths)) {
    assert.ok(pathItem.post, 'Each path should have a post operation');
    assert.ok(pathItem.post.operationId);
    assert.ok(pathItem.post.responses);
    assert.ok(pathItem.post.responses['200']);
    assert.ok(pathItem.post.responses['409']);
  }
});

test('generateOverlay — includes parameter refs', () => {
  const overlay = generateOverlay(sampleStateMachine, sampleEndpointInfo);
  const claimOp = overlay.actions[0].update['/tasks/{taskId}/claim'].post;

  assert.strictEqual(claimOp.parameters.length, 1);
  assert.strictEqual(claimOp.parameters[0].$ref, '#/components/parameters/TaskIdParam');
});

test('generateOverlay — includes tags from API spec', () => {
  const overlay = generateOverlay(sampleStateMachine, sampleEndpointInfo);
  const claimOp = overlay.actions[0].update['/tasks/{taskId}/claim'].post;

  assert.deepStrictEqual(claimOp.tags, ['Tasks']);
});

test('generateOverlay — includes requestBody for transitions with body', () => {
  const overlay = generateOverlay(sampleStateMachine, sampleEndpointInfo);
  const paths = overlay.actions[0].update;

  // claim has empty requestBodies entry — no requestBody
  assert.strictEqual(paths['/tasks/{taskId}/claim'].post.requestBody, undefined);

  // complete has a requestBody
  const completeBody = paths['/tasks/{taskId}/complete'].post.requestBody;
  assert.ok(completeBody);
  assert.strictEqual(completeBody.required, true);
  assert.ok(completeBody.content['application/json'].schema.properties.outcome);

  // release has a requestBody
  const releaseBody = paths['/tasks/{taskId}/release'].post.requestBody;
  assert.ok(releaseBody);
  assert.strictEqual(releaseBody.required, true);
  assert.ok(releaseBody.content['application/json'].schema.properties.reason);
});

test('generateOverlay — references resource schema in 200 response', () => {
  const overlay = generateOverlay(sampleStateMachine, sampleEndpointInfo);
  const claimOp = overlay.actions[0].update['/tasks/{taskId}/claim'].post;
  const schema = claimOp.responses['200'].content['application/json'].schema;

  assert.strictEqual(schema.$ref, '#/components/schemas/Task');
});

test('generateOverlay — correct operationIds', () => {
  const overlay = generateOverlay(sampleStateMachine, sampleEndpointInfo);
  const paths = overlay.actions[0].update;

  assert.strictEqual(paths['/tasks/{taskId}/claim'].post.operationId, 'claimTask');
  assert.strictEqual(paths['/tasks/{taskId}/complete'].post.operationId, 'completeTask');
  assert.strictEqual(paths['/tasks/{taskId}/release'].post.operationId, 'releaseTask');
});
