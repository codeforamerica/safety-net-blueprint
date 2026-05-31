/**
 * resolve-config.js
 *
 * Loads packages/explorer/config.yaml and enriches every flow step with
 * resolved annotation data from the contracts package.
 *
 * Steps with ref: "section/path" (e.g. ref: "operations/application.submit")
 * get a resolved policies: [...] array. Steps with legacy regulatory: [...]
 * are normalized to the same format so all renderers handle one shape.
 *
 * All renderers (context map, service blueprint) receive the enriched config
 * and read step.policies rather than step.ref or step.regulatory.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load packages/explorer/config.yaml and return it enriched with resolved
 * annotation data from the contracts package.
 *
 * @param {string} [contractsDir] path to the contracts package root.
 *   Defaults to packages/contracts relative to the explorer package.
 * @returns {Object} enriched config — same shape as config.yaml but with
 *   step.policies: [...] replacing step.ref annotation paths and step.regulatory arrays.
 */
export function resolveConfig(contractsDir) {
  contractsDir = contractsDir || resolve(__dirname, '..', '..', 'contracts');

  const config = yaml.load(readFileSync(join(__dirname, 'config.yaml'), 'utf8'));

  // Load all *-annotations.yaml files from contracts
  const annotations = {};
  if (existsSync(contractsDir)) {
    for (const f of readdirSync(contractsDir)) {
      if (!f.endsWith('-annotations.yaml')) continue;
      const data = yaml.load(readFileSync(join(contractsDir, f), 'utf8'));
      const domain = f.replace('-annotations.yaml', '');
      annotations[domain] = data;
    }
  }

  // Load all policy registry files from contracts
  const policies = {};
  if (existsSync(contractsDir)) {
    for (const f of readdirSync(contractsDir)) {
      if (!f.startsWith('platform-registry-policies') || !f.endsWith('.yaml')) continue;
      const data = yaml.load(readFileSync(join(contractsDir, f), 'utf8'));
      Object.assign(policies, data.policies || {});
    }
  }

  return {
    ...config,
    flows: (config.flows || []).map(flow => ({
      ...flow,
      steps: enrichSteps(flow.steps || [], annotations, policies),
    })),
  };
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function enrichSteps(steps, annotations, policies) {
  return steps.map(step => {
    // Recurse into fragment wrappers
    if (step.fragment !== undefined) {
      const enriched = { ...step };
      if (step.operands) {
        enriched.operands = step.operands.map(op => ({
          ...op,
          steps: enrichSteps(op.steps || [], annotations, policies),
        }));
      } else if (step.steps) {
        enriched.steps = enrichSteps(step.steps || [], annotations, policies);
      }
      return enriched;
    }

    const enriched = { ...step };

    // Resolve annotation ref (ref: "section/path") → policies array
    if (step.ref && step.ref.includes('/')) {
      const resolved = resolveAnnotationRef(step.ref, annotations, policies);
      if (resolved.length > 0) {
        enriched.policies = resolved;
      }
    }

    // Normalize legacy regulatory items to the same policies shape
    if (step.regulatory && step.regulatory.length > 0) {
      const converted = step.regulatory.map(r => ({
        id:          null,
        citation:    r.citation,
        description: [r.summary, r.detail].filter(Boolean).join(' — '),
        citationUrl: null,
        programs:    [],
      }));
      enriched.policies = (enriched.policies || []).concat(converted);
      delete enriched.regulatory;
    }

    return enriched;
  });
}

function resolveAnnotationRef(ref, annotations, policies) {
  const slashIdx = ref.indexOf('/');
  const section  = ref.slice(0, slashIdx);  // e.g. "operations"
  const path     = ref.slice(slashIdx + 1); // e.g. "application.submit"

  for (const domainAnnotations of Object.values(annotations)) {
    const sectionData = domainAnnotations[section];
    if (!sectionData) continue;
    const annotation = sectionData[path];
    if (!annotation) continue;

    return (annotation.policies || []).map(policyId => {
      const policy = policies[policyId];
      if (!policy) {
        console.warn(`Warning: policy '${policyId}' referenced in annotation '${ref}' not found in registry`);
        return { id: policyId, citation: policyId, description: '', citationUrl: null, programs: [] };
      }
      return {
        id:          policyId,
        citation:    policy.citation,
        description: (policy.description || '').trim().replace(/\s+/g, ' '),
        citationUrl: policy.citationUrl || null,
        programs:    policy.programs || [],
      };
    });
  }

  return [];
}
