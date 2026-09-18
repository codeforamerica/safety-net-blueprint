#!/usr/bin/env node
/**
 * AsyncAPI Generator
 *
 * Reads state machine contracts and generates AsyncAPI stub files with one
 * channel per emit step. On subsequent runs, new channels are added but
 * existing channels (and their payload schemas) are preserved.
 *
 * The state machine is the source of truth for which events a domain emits.
 * For emit steps that include a `data:` block, the generator resolves each
 * field reference against the domain's OpenAPI spec (for `$object.*` and
 * `$request.*` references) and generates a typed `*Data` schema automatically.
 * Collection references like `$members.*.id` produce `array<uuid>` types.
 *
 * Usage:
 *   node scripts/generate-asyncapi.js --spec=<contracts-dir>
 *   node scripts/generate-asyncapi.js --spec=<contracts-dir> --out=<output-dir>
 *
 *   --spec   Path to contracts directory containing *-state-machine.yaml files (required)
 *   --out    Output directory for generated AsyncAPI files (defaults to --spec)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { loadContractFiles } from '@codeforamerica/blueprint-core';

const __dirname = dirname(fileURLToPath(import.meta.url));

// =============================================================================
// Argument Parsing
// =============================================================================

const args = process.argv.slice(2);
const specArg = args.find(a => a.startsWith('--spec='));
const outArg  = args.find(a => a.startsWith('--out='));

if (!specArg) {
  console.error('Usage: node generate-asyncapi.js --spec=<contracts-dir> [--out=<output-dir>]');
  process.exit(1);
}

const specDir = resolve(process.cwd(), specArg.slice('--spec='.length));
const outDir  = outArg ? resolve(process.cwd(), outArg.slice('--out='.length)) : specDir;

// =============================================================================
// Schema helpers — look up a property name through allOf branches
// =============================================================================

function lookupProperty(schema, fieldName) {
  if (!schema || typeof schema !== 'object') return null;
  if (schema.properties?.[fieldName]) return schema.properties[fieldName];
  for (const branch of schema.allOf ?? []) {
    const found = lookupProperty(branch, fieldName);
    if (found) return found;
  }
  return null;
}

// Copy only the type-defining fields from an OpenAPI property schema, dropping
// description, examples, x-* extensions, and other non-structural metadata.
function toTypeStructure(prop) {
  if (!prop || typeof prop !== 'object') return { type: 'string' };
  const result = {};
  for (const key of ['type', 'format', 'enum', 'items', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern']) {
    if (prop[key] !== undefined) result[key] = prop[key];
  }
  return Object.keys(result).length > 0 ? result : { type: 'string' };
}

// Resolve a data field reference to a JSON Schema type structure.
//   $object.fieldName     → look up in the primary resource schema
//   $request.fieldName    → look up in the action's request schema
//   $ctx.*.fieldName      → array; if fieldName is 'id', items are uuid strings
function resolveDataFieldType(ref, objectSchema, requestSchema) {
  // Collection pattern: $<name>.*.field (e.g. $members.*.id)
  const collectionMatch = typeof ref === 'string' && ref.match(/^\$\w+\.\*\.(\w+)$/);
  if (collectionMatch) {
    const fieldName = collectionMatch[1];
    return fieldName === 'id'
      ? { type: 'array', items: { type: 'string', format: 'uuid' } }
      : { type: 'array', items: { type: 'string' } };
  }

  if (typeof ref !== 'string') return { type: 'string' };

  if (ref.startsWith('$object.')) {
    const fieldName = ref.slice('$object.'.length);
    return toTypeStructure(lookupProperty(objectSchema, fieldName));
  }

  if (ref.startsWith('$request.')) {
    const fieldName = ref.slice('$request.'.length);
    return toTypeStructure(lookupProperty(requestSchema, fieldName));
  }

  return { type: 'string' };
}

// =============================================================================
// Collect emit steps with data blocks from a set of state machine docs
// =============================================================================

// Returns Map<eventType, { data, objectSchema, requestSchema }>.
// Only includes emit steps that have a `data:` block.
// First occurrence wins (deduplicates by event type).
function collectEmitDataByType(stateMachineDocs, domainObjectSchemas) {
  const byType = new Map();

  for (const doc of stateMachineDocs) {
    for (const machine of doc.machines ?? []) {
      const objectSchema = domainObjectSchemas?.get(machine.object) ?? null;

      for (const action of machine.actions ?? []) {
        // Resolve the action's request schema from the state machine's $defs
        let requestSchema = null;
        const requestRef = action.schema?.request?.['$ref'];
        if (requestRef) {
          const match = requestRef.match(/^#\/\$defs\/(.+)$/);
          if (match) requestSchema = doc['$defs']?.[match[1]] ?? null;
        }

        for (const step of action.steps ?? []) {
          if (step.emit?.type && step.emit.data && !byType.has(step.emit.type)) {
            byType.set(step.emit.type, {
              data: step.emit.data,
              objectSchema,
              requestSchema,
            });
          }
        }
      }
    }
  }

  return byType;
}

// =============================================================================
// Name helpers
// =============================================================================

// intake.application.submitted → ApplicationSubmitted
// intake.application.review_completed → ApplicationReviewCompleted
function eventTypeToName(eventType, domain) {
  const withoutDomain = eventType.startsWith(domain + '.')
    ? eventType.slice(domain.length + 1)
    : eventType;
  return withoutDomain
    .split(/[._]/)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

// =============================================================================
// Generate a channel + message + schema stub for one event type
// =============================================================================

// dataInfo: { data, objectSchema, requestSchema } | null
function buildChannelStub(eventType, name, dataInfo) {
  // Resolve *Data schema if the emit step includes a data block
  let dataSchema = null;
  if (dataInfo) {
    const { data, objectSchema, requestSchema } = dataInfo;
    const properties = {};
    for (const [fieldName, ref] of Object.entries(data)) {
      properties[fieldName] = resolveDataFieldType(ref, objectSchema, requestSchema);
    }
    dataSchema = {
      type: 'object',
      additionalProperties: false,
      properties,
    };
  }

  return {
    channel: {
      address: eventType,
      messages: {
        [name]: { $ref: `#/components/messages/${name}Message` },
      },
    },
    message: {
      name: eventType,
      summary: 'TODO — describe when this event is emitted and who consumes it.',
      payload: { $ref: `#/components/schemas/${name}Event` },
    },
    schema: {
      allOf: [
        { $ref: 'https://blueprint.codeforamerica.org/base/schemas/events.yaml#/$defs/Event' },
        {
          type: 'object',
          properties: {
            type: { type: 'string', const: eventType },
            ...(dataSchema ? { data: { $ref: `#/components/schemas/${name}Data` } } : {}),
          },
        },
      ],
    },
    dataSchema,
  };
}

// =============================================================================
// Main
// =============================================================================

const fileMap = loadContractFiles(specDir);

// Build domain → objectName → schema index from OpenAPI specs
const domainObjectSchemasMap = new Map(); // domain → Map<objectName, schema>
for (const { content, type, domain } of fileMap.values()) {
  if (type !== 'openapi') continue;
  if (!domain) continue;
  if (!domainObjectSchemasMap.has(domain)) domainObjectSchemasMap.set(domain, new Map());
  const domainSchemas = domainObjectSchemasMap.get(domain);
  for (const [schemaName, schema] of Object.entries(content?.components?.schemas ?? {})) {
    if (!domainSchemas.has(schemaName)) domainSchemas.set(schemaName, schema);
  }
}

// Group state machine docs by domain
const stateMachinesByDomain = new Map();
for (const { content, type } of fileMap.values()) {
  if (type !== 'state-machine') continue;
  const domain = content?.domain;
  if (!domain) continue;
  if (!stateMachinesByDomain.has(domain)) stateMachinesByDomain.set(domain, []);
  stateMachinesByDomain.get(domain).push(content);
}

if (stateMachinesByDomain.size === 0) {
  console.log('No state machine files found.');
  process.exit(0);
}

let totalNew = 0;

for (const [domain, machines] of stateMachinesByDomain) {
  // Collect all emit types across all machines for this domain
  const emitTypes = new Set();
  for (const machine of machines) {
    for (const m of machine.machines ?? []) {
      for (const action of m.actions ?? []) {
        for (const step of action.steps ?? []) {
          if (step.emit?.type) emitTypes.add(step.emit.type);
        }
      }
    }
  }

  if (emitTypes.size === 0) {
    console.log(`  ${domain}: no emit steps — skipping`);
    continue;
  }

  // Collect emit steps that have data blocks, for generating *Data schemas
  const domainSchemas = domainObjectSchemasMap.get(domain) ?? null;
  const emitDataByType = collectEmitDataByType(machines, domainSchemas);

  const outFile = join(outDir, `${domain}-asyncapi.yaml`);

  // Load existing file if present (preserves existing payload schemas)
  let existing = null;
  if (existsSync(outFile)) {
    try {
      existing = yaml.load(readFileSync(outFile, 'utf8'));
    } catch {
      existing = null;
    }
  }

  const existingChannels = existing?.channels   ?? {};
  const existingMessages = existing?.components?.messages ?? {};
  const existingSchemas  = existing?.components?.schemas  ?? {};

  const channels  = { ...existingChannels };
  const messages  = { ...existingMessages };
  const schemas   = { ...existingSchemas };

  let newCount = 0;
  for (const eventType of [...emitTypes].sort()) {
    if (channels[eventType]) continue; // already exists — preserve

    const name  = eventTypeToName(eventType, domain);
    const stub  = buildChannelStub(eventType, name, emitDataByType.get(eventType) ?? null);
    channels[eventType]        = stub.channel;
    messages[`${name}Message`] = stub.message;
    schemas[`${name}Event`]    = stub.schema;
    if (stub.dataSchema) schemas[`${name}Data`] = stub.dataSchema;
    newCount++;
  }

  if (newCount === 0 && existing) {
    console.log(`  ${domain}: ${emitTypes.size} channel(s) — up to date`);
    continue;
  }

  const doc = {
    asyncapi: '3.0.0',
    info: existing?.info ?? {
      title: `${domain.charAt(0).toUpperCase() + domain.slice(1)} Domain Events`,
      version: '0.1.0',
      'x-status': 'draft',
      description:
        `Event catalog for the ${domain.charAt(0).toUpperCase() + domain.slice(1)} domain.\n` +
        `Generated from ${domain}-state-machine.yaml — add payload schemas below.\n`,
    },
    channels,
    components: { messages, schemas },
  };

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, yaml.dump(doc, { lineWidth: 120, noRefs: true }), 'utf8');

  const action = existing ? `updated (+${newCount} channel(s))` : `created (${newCount} channel(s))`;
  console.log(`  ${domain}-asyncapi.yaml ${action}`);
  totalNew += newCount;
}

console.log(`\nDone. ${totalNew} new channel(s) added.`);
