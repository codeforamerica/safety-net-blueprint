/**
 * Executor for state machine PUT steps targeting singleton sub-resources.
 *
 * State machine procedures use `call: {PUT: domain/parent/<id>/sub-resource}` to
 * refresh server-assembled singletons (e.g., EligibilitySnapshot). This module
 * parses the interpolated path, looks up the registered assembler, upserts the
 * record using the same delete-and-reinsert pattern as the HTTP PUT handler, and
 * emits the appropriate domain event.
 *
 * The assembler registry is keyed by sub-resource slug (e.g., "eligibility-snapshot").
 * To register a new assembler, add an entry to SINGLETON_PUT_ASSEMBLERS_BY_RESOURCE.
 */

import { randomUUID } from 'crypto';
import { findAll, deleteResource, insertResource } from './database-manager.js';
import { emitEvent } from './emit-event.js';
import { assembleEligibilitySnapshot } from './handlers/eligibility-snapshot-handler.js';

const SINGLETON_PUT_ASSEMBLERS_BY_RESOURCE = {
  'eligibility-snapshot': assembleEligibilitySnapshot,
};

/**
 * Execute a singleton PUT step from a state machine.
 * Parses the fully-interpolated path to extract domain, parent collection, parent ID,
 * and sub-resource slug; looks up the registered assembler; upserts the record; emits
 * the domain event; and returns the stored record.
 *
 * Returns null if no assembler is registered for the sub-resource slug (so callers can
 * fall back gracefully) or if the assembler returns null (parent not found).
 *
 * @param {string} interpolatedPath - Fully resolved path, e.g. "intake/applications/<uuid>/eligibility-snapshot"
 * @param {Object} [opts]
 * @param {string} [opts.now]          - ISO timestamp; defaults to current time
 * @param {string|null} [opts.traceparent]
 * @param {string|null} [opts.causationid]
 * @returns {Object|null}
 */
export function executeSingletonPut(interpolatedPath, opts = {}) {
  const { now = new Date().toISOString(), traceparent = null, causationid = null } = opts;

  const parts = interpolatedPath.split('/');
  if (parts.length < 4) {
    console.warn(`executeSingletonPut: path "${interpolatedPath}" needs at least 4 segments (domain/collection/parentId/subResource)`);
    return null;
  }

  const subResource = parts[parts.length - 1];           // "eligibility-snapshot"
  const parentId = parts[parts.length - 2];              // the parent UUID
  const parentCollectionSeg = parts[parts.length - 3];   // "applications"
  const domain = parts[0];                               // "intake"

  const assembler = SINGLETON_PUT_ASSEMBLERS_BY_RESOURCE[subResource];
  if (!assembler) return null; // unknown sub-resource — not an error, just not handled here

  const bodyData = assembler(parentId);
  if (bodyData === null) {
    console.warn(`executeSingletonPut: assembler returned null for "${interpolatedPath}" — parent not found`);
    return null;
  }

  // Collection name: pluralize the sub-resource slug (matches route-generator convention)
  const collection = `${subResource}s`;

  // Parent field: <parentSingular>Id — matches the URL param name convention
  const parentSingular = parentCollectionSeg.endsWith('s')
    ? parentCollectionSeg.slice(0, -1)
    : parentCollectionSeg;
  const parentField = `${parentSingular}Id`; // e.g., "applicationId"

  const { items } = findAll(collection, { [parentField]: parentId }, { limit: 1 });
  let result;
  let action;

  if (items.length === 0) {
    result = { id: randomUUID(), [parentField]: parentId, ...bodyData, createdAt: now, updatedAt: now };
    insertResource(collection, result);
    action = 'created';
  } else {
    deleteResource(collection, items[0].id);
    result = { id: items[0].id, [parentField]: parentId, ...bodyData, createdAt: items[0].createdAt, updatedAt: now };
    insertResource(collection, result);
    action = 'updated';
  }

  try {
    emitEvent({
      domain,
      object: subResource,
      action,
      resourceId: result.id,
      subject: parentId,
      source: `/${domain}`,
      data: result,
      callerId: 'system',
      traceparent,
      causationid,
      now,
    });
  } catch (e) { /* non-fatal — event emission failure should not block the upsert */ }

  return result;
}
