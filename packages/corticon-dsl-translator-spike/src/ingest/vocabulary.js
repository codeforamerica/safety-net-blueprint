import path from 'node:path';
import { existsSync } from 'node:fs';
import { parseCorticonXml, asArray } from './xml.js';

const ECORE_TYPE_MAP = {
  EString: 'String',
  ELongObject: 'Integer',
  EIntegerObject: 'Integer',
  EDoubleObject: 'Decimal',
  EBooleanObject: 'Boolean',
  EBigDecimal: 'Decimal',
};

// Corticon emits an enum type two ways, sometimes both at once for the same name:
// a `customDataTypeList` annotation (UI metadata: base type, enumeration flag,
// enumerationElements), and/or a plain EMF `eClassifiers[xsi:type=ecore:EEnum]`
// with `eLiterals`. Confirmed real in DC Medicaid's `Rule Vocabulary.ecore` (both
// forms present for `state_name` etc.) and `InsuranceSalesProcess.ecore` (many
// EEnum classifiers, not all confirmed to have a customDataTypeList sibling).
// Crucially, every real cross-file `eType` reference found points at an EEnum
// classifier, never a customDataTypeList entry -- so both sources must be merged
// for cross-file resolution to ever find anything.
function extractCustomTypes(root) {
  const customTypes = new Map();
  for (const annotation of asArray(root?.eAnnotations)) {
    const rootExtension = annotation?.contents;
    for (const dt of asArray(rootExtension?.customDataTypeList)) {
      const name = dt?.dataTypeName?.['@_value'];
      if (!name) continue;
      customTypes.set(name, {
        baseType: dt?.baseDataType?.['@_value'],
        isEnum: dt?.enumeration?.['@_value'] === 'true',
        values: asArray(dt?.enumerationElements).map((el) => el?.value?.['@_value']),
      });
    }
  }
  for (const classifier of asArray(root?.eClassifiers)) {
    if (classifier?.['@_xsi:type'] !== 'ecore:EEnum') continue;
    const name = classifier['@_name'];
    if (!name || customTypes.has(name)) continue; // customDataTypeList sibling already covers it
    customTypes.set(name, {
      baseType: 'String',
      isEnum: true,
      values: asArray(classifier?.eLiterals).map((lit) => lit?.['@_literal']),
    });
  }
  return customTypes;
}

// Splits an eType string into its optional path/URI prefix and the local name
// after the last `#//`. E.g. "ecore:EEnum ../Other.ecore#//state_name" ->
// { prefix: '../Other.ecore', name: 'state_name' }.
function splitEType(eType) {
  const hashIndex = eType.lastIndexOf('#//');
  if (hashIndex < 0) return { prefix: null, name: eType };
  const before = eType.slice(0, hashIndex);
  const spaceIndex = before.indexOf(' ');
  const prefix = (spaceIndex >= 0 ? before.slice(spaceIndex + 1) : before).trim();
  return { prefix: prefix || null, name: eType.slice(hashIndex + 3) };
}

// Loads just the customTypes of another vocabulary file referenced by a
// cross-file eType. `cache` is shared across one top-level parseVocabulary()
// call so the same file isn't re-parsed twice and reference cycles can't recurse forever.
function loadReferencedCustomTypes(referencedPath, cache) {
  if (cache.has(referencedPath)) return cache.get(referencedPath);
  cache.set(referencedPath, new Map()); // placeholder: breaks cycles before this parse completes
  const doc = parseCorticonXml(referencedPath);
  const customTypes = extractCustomTypes(doc['ecore:EPackage']);
  cache.set(referencedPath, customTypes);
  return customTypes;
}

/**
 * Resolves an eType to a primitive, custom-type, or plain entity/association
 * reference. A prefix that is a relative file path (not an `http:` URI) before
 * the `#//name` means the custom type is declared in a *different* vocabulary
 * file -- confirmed real in DC Medicaid's `Household.state`
 * (`eType="ecore:EEnum ../../NY State Assistance/Vocabulary/Rule Vocabulary.ecore#//state_name"`).
 * That file is resolved relative to the current file's own directory and parsed
 * to find the type there (via extractCustomTypes, which merges both real enum
 * shapes -- see its own comment). If the referenced file can't be found on disk
 * (e.g. a reference to a sample project that was never vendored alongside this
 * one), this falls back to the caller's own same-file customTypes lookup, same
 * as before.
 */
function resolveEType(eType, ctx) {
  if (!eType) return { kind: 'unknown', name: eType };
  const { prefix, name: localName } = splitEType(eType);
  if (eType.includes('Ecore#//')) {
    return { kind: 'primitive', name: ECORE_TYPE_MAP[localName] ?? localName };
  }
  if (eType.includes('canonicalvocabularymodel.ecore#//')) {
    // Corticon's own base types beyond plain Ecore primitives (e.g. Date, Time, DateTime).
    return { kind: 'primitive', name: localName };
  }
  if (prefix && !prefix.startsWith('http') && ctx) {
    const referencedPath = path.resolve(ctx.baseDir, decodeURIComponent(prefix));
    if (referencedPath !== ctx.filePath && existsSync(referencedPath)) {
      const referencedTypes = loadReferencedCustomTypes(referencedPath, ctx.cache);
      if (referencedTypes.has(localName)) return { kind: 'customType', name: localName };
    }
  }
  // A bare `#//Name` reference (or an unresolvable cross-file one) is either a
  // custom data type (enum) defined in this same Vocabulary file, or another
  // entity (for an EReference/association) — the caller disambiguates using
  // which one actually resolves.
  return { kind: 'reference', name: localName };
}

/** Parse a Corticon Vocabulary (.ecore) file into { entities, customTypes }. */
export function parseVocabulary(filePath) {
  const doc = parseCorticonXml(filePath);
  const root = doc['ecore:EPackage'];
  const customTypes = extractCustomTypes(root);
  const ctx = { filePath: path.resolve(filePath), baseDir: path.dirname(filePath), cache: new Map() };

  const entities = new Map();
  for (const classifier of asArray(root?.eClassifiers)) {
    if (classifier?.['@_xsi:type'] !== 'ecore:EClass') continue;
    const entityName = classifier['@_name'];
    const attributes = new Map();
    for (const feature of asArray(classifier?.eStructuralFeatures)) {
      const featureName = feature?.['@_name'];
      if (!featureName) continue;
      const isAssociation = feature['@_xsi:type'] === 'ecore:EReference';
      const isCollection = feature['@_upperBound'] === '-1';
      const resolved = resolveEType(feature['@_eType'], ctx);
      attributes.set(featureName, {
        kind: isAssociation ? 'association' : 'attribute',
        isCollection,
        type: resolved.kind === 'reference' && customTypes.has(resolved.name)
          ? { kind: 'customType', name: resolved.name }
          : resolved,
      });
    }
    entities.set(entityName, { attributes });
  }

  return { entities, customTypes };
}
