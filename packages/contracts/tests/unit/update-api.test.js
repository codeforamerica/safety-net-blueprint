/**
 * Unit tests for update-api.js
 * Tests URL prefix detection, resource merging, and examples appending.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import yaml from 'js-yaml';
import {
  detectUrlPrefix,
  mergeResource,
  appendExamples
} from '../../scripts/update-api.js';

// Helper: minimal existing spec with a /workflow prefix
function makeWorkflowSpec() {
  return yaml.load(`
openapi: 3.1.0
info:
  title: Workflow Service API
  version: 1.0.0
tags:
  - name: Tasks
    description: Manage tasks.
paths:
  "/workflow/tasks":
    get:
      summary: List tasks
      operationId: listTasks
      tags:
        - Tasks
  "/workflow/tasks/{taskId}":
    parameters:
      - $ref: "#/components/parameters/TaskIdParam"
    get:
      summary: Get a task
      operationId: getTask
      tags:
        - Tasks
components:
  parameters:
    TaskIdParam:
      name: taskId
      in: path
      required: true
      schema:
        type: string
        format: uuid
  schemas:
    Task:
      type: object
      properties:
        id:
          type: string
    TaskCreate:
      allOf:
        - $ref: "#/components/schemas/Task"
    TaskUpdate:
      allOf:
        - $ref: "#/components/schemas/Task"
    TaskList:
      type: object
      properties:
        items:
          type: array
`);
}

// Helper: minimal spec without URL prefix
function makeNoPrefixSpec() {
  return yaml.load(`
openapi: 3.1.0
info:
  title: Benefits API
  version: 1.0.0
tags:
  - name: Benefits
    description: Manage benefits.
paths:
  "/benefits":
    get:
      summary: List benefits
  "/benefits/{benefitId}":
    get:
      summary: Get a benefit
components:
  parameters:
    BenefitIdParam:
      name: benefitId
      in: path
      required: true
      schema:
        type: string
  schemas:
    Benefit:
      type: object
`);
}

test('update-api tests', async (t) => {
  // ===========================================================================
  // detectUrlPrefix
  // ===========================================================================

  await t.test('detectUrlPrefix - detects /workflow from prefixed paths', () => {
    const paths = {
      '/workflow/tasks': {},
      '/workflow/tasks/{taskId}': {}
    };
    assert.strictEqual(detectUrlPrefix(paths), '/workflow');
  });

  await t.test('detectUrlPrefix - returns empty string when no prefix', () => {
    const paths = {
      '/tasks': {},
      '/tasks/{taskId}': {}
    };
    assert.strictEqual(detectUrlPrefix(paths), '');
  });

  await t.test('detectUrlPrefix - returns empty string for empty paths', () => {
    assert.strictEqual(detectUrlPrefix({}), '');
  });

  await t.test('detectUrlPrefix - handles multi-segment prefix', () => {
    const paths = {
      '/api/v1/tasks': {},
      '/api/v1/tasks/{taskId}': {}
    };
    assert.strictEqual(detectUrlPrefix(paths), '/api/v1');
  });

  // ===========================================================================
  // mergeResource - paths
  // ===========================================================================

  await t.test('mergeResource - adds new paths with prefix', () => {
    const spec = makeWorkflowSpec();
    mergeResource(spec, 'workflow', 'Queue');

    // Existing paths preserved
    assert.ok(spec.paths['/workflow/tasks']);
    assert.ok(spec.paths['/workflow/tasks/{taskId}']);
    // New paths added with /workflow prefix
    assert.ok(spec.paths['/workflow/queues']);
    assert.ok(spec.paths['/workflow/queues/{queueId}']);
  });

  await t.test('mergeResource - adds paths without prefix when none exists', () => {
    const spec = makeNoPrefixSpec();
    mergeResource(spec, 'benefits', 'Category');

    assert.ok(spec.paths['/benefits']);
    assert.ok(spec.paths['/categories']);
    assert.ok(spec.paths['/categories/{categoryId}']);
  });

  await t.test('mergeResource - new list endpoint has correct operationId', () => {
    const spec = makeWorkflowSpec();
    mergeResource(spec, 'workflow', 'Queue');

    const listOp = spec.paths['/workflow/queues'].get;
    assert.strictEqual(listOp.operationId, 'listQueues');
  });

  await t.test('mergeResource - new collection has POST with create operationId', () => {
    const spec = makeWorkflowSpec();
    mergeResource(spec, 'workflow', 'Queue');

    const createOp = spec.paths['/workflow/queues'].post;
    assert.strictEqual(createOp.operationId, 'createQueue');
  });

  // ===========================================================================
  // mergeResource - schemas
  // ===========================================================================

  await t.test('mergeResource - adds all four schemas', () => {
    const spec = makeWorkflowSpec();
    mergeResource(spec, 'workflow', 'Queue');

    assert.ok(spec.components.schemas.Queue);
    assert.ok(spec.components.schemas.QueueCreate);
    assert.ok(spec.components.schemas.QueueUpdate);
    assert.ok(spec.components.schemas.QueueList);
  });

  await t.test('mergeResource - preserves existing schemas', () => {
    const spec = makeWorkflowSpec();
    mergeResource(spec, 'workflow', 'Queue');

    assert.ok(spec.components.schemas.Task);
    assert.ok(spec.components.schemas.TaskCreate);
    assert.ok(spec.components.schemas.TaskUpdate);
    assert.ok(spec.components.schemas.TaskList);
  });

  // ===========================================================================
  // mergeResource - parameters
  // ===========================================================================

  await t.test('mergeResource - adds new parameter', () => {
    const spec = makeWorkflowSpec();
    mergeResource(spec, 'workflow', 'Queue');

    assert.ok(spec.components.parameters.QueueIdParam);
    assert.strictEqual(spec.components.parameters.QueueIdParam.name, 'queueId');
  });

  await t.test('mergeResource - preserves existing parameters', () => {
    const spec = makeWorkflowSpec();
    mergeResource(spec, 'workflow', 'Queue');

    assert.ok(spec.components.parameters.TaskIdParam);
  });

  // ===========================================================================
  // mergeResource - tags
  // ===========================================================================

  await t.test('mergeResource - appends new tag', () => {
    const spec = makeWorkflowSpec();
    mergeResource(spec, 'workflow', 'Queue');

    assert.strictEqual(spec.tags.length, 2);
    assert.strictEqual(spec.tags[0].name, 'Tasks');
    assert.strictEqual(spec.tags[1].name, 'Queues');
  });

  // ===========================================================================
  // mergeResource - examples reference
  // ===========================================================================

  await t.test('mergeResource - get endpoint references examples file', () => {
    const spec = makeWorkflowSpec();
    mergeResource(spec, 'workflow', 'Queue');

    const getOp = spec.paths['/workflow/queues/{queueId}'].get;
    const examples = getOp.responses['200'].content['application/json'].examples;
    assert.ok(examples.QueueExample1);
    assert.strictEqual(
      examples.QueueExample1['$ref'],
      './workflow-openapi-examples.yaml#/QueueExample1'
    );
  });

  // ===========================================================================
  // mergeResource - error cases
  // ===========================================================================

  await t.test('mergeResource - throws when resource already exists', () => {
    const spec = makeWorkflowSpec();

    assert.throws(
      () => mergeResource(spec, 'workflow', 'Task'),
      { message: 'Resource "Task" already exists in the spec (found in components.schemas).' }
    );
  });

  // ===========================================================================
  // appendExamples
  // ===========================================================================

  await t.test('appendExamples - appends data without header comments', () => {
    const existing = `# Task Examples
TaskExample1:
  id: "abc"
  name: "Task 1"
`;
    const newExamples = `# Queue Examples
# Example data for testing and documentation.

QueueExample1:
  id: "def"
  name: "Queue 1"

QueueExample2:
  id: "ghi"
  name: "Queue 2"
`;
    const result = appendExamples(existing, newExamples);

    // Existing content preserved
    assert.ok(result.includes('TaskExample1:'));
    // New content appended without comment headers
    assert.ok(result.includes('QueueExample1:'));
    assert.ok(result.includes('QueueExample2:'));
    // Comment headers stripped
    assert.ok(!result.includes('# Queue Examples'));
    assert.ok(!result.includes('# Example data'));
  });

  await t.test('appendExamples - result ends with newline', () => {
    const existing = 'TaskExample1:\n  id: "abc"';
    const newExamples = '# Header\n\nQueueExample1:\n  id: "def"\n';
    const result = appendExamples(existing, newExamples);

    assert.ok(result.endsWith('\n'));
  });
});
