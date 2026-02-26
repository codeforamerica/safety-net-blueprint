#!/usr/bin/env node
/**
 * RPC Overlay Generator
 *
 * Reads state machine contracts and generates OpenAPI overlay files
 * that add RPC (transition) endpoints to the base REST spec.
 *
 * Usage:
 *   node scripts/generate-rpc-overlay.js --spec=.
 *   npm run generate:rpc-overlay
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { realpathSync } from 'fs';
import yaml from 'js-yaml';

// =============================================================================
// Argument Parsing
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { specsDir: null, help: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--spec=')) {
      options.specsDir = args[i].split('=')[1];
    } else if (args[i] === '--spec') {
      options.specsDir = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      options.help = true;
    } else {
      console.error(`Error: Unknown argument: ${args[i]}`);
      process.exit(1);
    }
  }

  return options;
}

// =============================================================================
// State Machine Discovery
// =============================================================================

/**
 * Discover state machine YAML files in the specs directory.
 * @param {string} specsDir - Path to the specs directory
 * @returns {Array<{ filePath: string, stateMachine: Object }>}
 */
export function discoverStateMachines(specsDir) {
  let files;
  try {
    files = readdirSync(specsDir);
  } catch {
    return [];
  }

  const results = [];
  for (const file of files) {
    if (!file.endsWith('-state-machine.yaml')) continue;

    const filePath = join(specsDir, file);
    try {
      const content = readFileSync(filePath, 'utf8');
      const stateMachine = yaml.load(content);
      if (!stateMachine || !stateMachine.domain || !stateMachine.object) continue;
      results.push({ filePath, stateMachine });
    } catch {
      continue;
    }
  }

  return results;
}

// =============================================================================
// API Spec Reading
// =============================================================================

/**
 * Read the base API spec and extract the item endpoint path and parameter refs.
 * @param {string} specsDir - Path to the specs directory
 * @param {string} apiSpecFile - Filename of the API spec (e.g., "workflow-openapi.yaml")
 * @returns {{ itemPath: string, paramRefs: Array, tag: string } | null}
 */
export function extractItemEndpoint(specsDir, apiSpecFile) {
  const specPath = join(specsDir, apiSpecFile);
  let spec;
  try {
    spec = yaml.load(readFileSync(specPath, 'utf8'));
  } catch {
    return null;
  }

  const paths = spec.paths || {};
  for (const [pathKey, pathItem] of Object.entries(paths)) {
    // Item endpoints contain a path parameter like {taskId}
    if (!pathKey.includes('{')) continue;

    // Get the parameter references from the path item
    const paramRefs = pathItem.parameters || [];

    // Get the tag from the GET operation if available
    const getOp = pathItem.get || {};
    const tag = getOp.tags?.[0] || null;

    // Get the resource schema ref from the GET 200 response
    const schemaRef = getOp.responses?.['200']?.content?.['application/json']?.schema?.$ref || null;

    return { itemPath: pathKey, paramRefs, tag, schemaRef };
  }

  return null;
}

// =============================================================================
// Overlay Generation
// =============================================================================

/**
 * Build an operation ID from trigger name and object name.
 * E.g., ("claim", "Task") → "claimTask"
 * @param {string} trigger - Transition trigger name
 * @param {string} objectName - Object name (e.g., "Task")
 * @returns {string}
 */
export function buildOperationId(trigger, objectName) {
  return `${trigger}${objectName}`;
}

/**
 * Build a request body schema from the state machine's requestBodies entry.
 * @param {Object} bodyDef - The requestBodies definition for this trigger
 * @returns {Object|null} OpenAPI requestBody object, or null if no body needed
 */
function buildRequestBody(bodyDef) {
  if (!bodyDef || Object.keys(bodyDef).length === 0) {
    return null;
  }

  return {
    required: true,
    content: {
      'application/json': {
        schema: bodyDef
      }
    }
  };
}

/**
 * Generate an OpenAPI overlay for a single state machine.
 * @param {Object} stateMachine - The parsed state machine contract
 * @param {{ itemPath: string, paramRefs: Array, tag: string, schemaRef: string }} endpointInfo
 * @returns {Object} Overlay document
 */
export function generateOverlay(stateMachine, endpointInfo) {
  const { itemPath, paramRefs, tag, schemaRef } = endpointInfo;
  const requestBodies = stateMachine.requestBodies || {};

  const pathsUpdate = {};

  for (const transition of stateMachine.transitions) {
    const rpcPath = `${itemPath}/${transition.trigger}`;
    const operationId = buildOperationId(transition.trigger, stateMachine.object);

    const operation = {
      summary: `${transition.trigger.charAt(0).toUpperCase() + transition.trigger.slice(1)} ${stateMachine.object.toLowerCase()}`,
      description: `Trigger the ${transition.trigger} transition (${transition.from} → ${transition.to}).`,
      operationId
    };

    if (tag) {
      operation.tags = [tag];
    }

    // Copy parameter references from the item endpoint
    if (paramRefs.length > 0) {
      operation.parameters = paramRefs.map(ref => {
        if (ref.$ref) return { $ref: ref.$ref };
        return ref;
      });
    }

    // Add request body if defined
    const bodyDef = requestBodies[transition.trigger];
    const requestBody = buildRequestBody(bodyDef);
    if (requestBody) {
      operation.requestBody = requestBody;
    }

    // Standard responses
    const responses = {
      '200': {
        description: 'Transition applied successfully.',
        content: {
          'application/json': {
            schema: schemaRef ? { $ref: schemaRef } : { type: 'object' }
          }
        }
      },
      '400': { $ref: './components/responses.yaml#/BadRequest' },
      '404': { $ref: './components/responses.yaml#/NotFound' },
      '409': { $ref: './components/responses.yaml#/Conflict' },
      '500': { $ref: './components/responses.yaml#/InternalError' }
    };

    operation.responses = responses;
    pathsUpdate[rpcPath] = { post: operation };
  }

  return {
    overlay: '1.0.0',
    info: {
      title: `${stateMachine.domain} RPC Overlay`,
      version: '1.0.0',
      description: `Auto-generated RPC endpoints from ${stateMachine.domain}-state-machine.yaml`
    },
    actions: [
      {
        target: '$.paths',
        file: stateMachine.apiSpec,
        description: `Add state machine transition endpoints for ${stateMachine.domain} ${stateMachine.object.toLowerCase()}s`,
        update: pathsUpdate
      }
    ]
  };
}

// =============================================================================
// Main
// =============================================================================

function main() {
  const options = parseArgs();

  if (options.help) {
    console.log('Usage: node scripts/generate-rpc-overlay.js --spec=<dir>');
    console.log('');
    console.log('Options:');
    console.log('  --spec=<dir>   Directory containing spec and state machine files');
    console.log('  --help, -h     Show this help message');
    process.exit(0);
  }

  const specsDir = resolve(options.specsDir || '.');

  console.log('Generating RPC overlays...');
  console.log(`  Specs directory: ${specsDir}`);

  const machines = discoverStateMachines(specsDir);

  if (machines.length === 0) {
    console.log('  No state machine contracts found.');
    return;
  }

  const outDir = join(specsDir, 'overlays');
  mkdirSync(outDir, { recursive: true });

  for (const { stateMachine } of machines) {
    const apiSpecFile = stateMachine.apiSpec;
    if (!apiSpecFile) {
      console.warn(`  Skipping ${stateMachine.domain}: no apiSpec field`);
      continue;
    }

    const endpointInfo = extractItemEndpoint(specsDir, apiSpecFile);
    if (!endpointInfo) {
      console.warn(`  Skipping ${stateMachine.domain}: could not find item endpoint in ${apiSpecFile}`);
      continue;
    }

    const overlay = generateOverlay(stateMachine, endpointInfo);
    const overlayYaml = yaml.dump(overlay, { lineWidth: 120, noRefs: true, quotingType: '"' });
    const outPath = join(outDir, `${stateMachine.domain}-rpc.yaml`);
    writeFileSync(outPath, overlayYaml, 'utf8');

    console.log(`  ✓ ${stateMachine.domain}-rpc.yaml (${stateMachine.transitions.length} transition(s))`);
  }

  console.log('✓ RPC overlay generation complete');
}

// Export for testing
export { parseArgs, buildRequestBody };

// Run main when executed directly
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]));
if (isDirectRun) {
  main();
}
