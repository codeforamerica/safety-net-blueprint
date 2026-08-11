import path from 'node:path';
import { existsSync } from 'node:fs';
import { parseCorticonXml, asArray } from './xml.js';

// Maps EMF Ecore built-in type names to Corticon's own display names.
// Both primitive (EInt, EBoolean) and boxed-object (EIntegerObject, EBooleanObject)
// variants are included — confirmed real: expedited-snap uses EString while DC Medicaid
// uses the canonicalvocabularymodel#//String form; both must resolve to 'String'.
const ECORE_TYPE_MAP = {
  EString:        'String',
  EBoolean:       'Boolean',
  EBooleanObject: 'Boolean',
  EInt:           'Integer',
  EIntegerObject: 'Integer',
  ELong:          'Integer',
  ELongObject:    'Integer',
  EDouble:        'Decimal',
  EDoubleObject:  'Decimal',
  EFloat:         'Decimal',
  EBigDecimal:    'Decimal',
  EBigInteger:    'Integer',
  EByte:          'Integer',
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
// Strips the code prefix from a Corticon enum literal display name and converts
// underscores to spaces. E.g. name="AF0018_Non_recipient_Fraud", value="'AF0018'"
// → "Non recipient Fraud". If the name doesn't start with the code, replaces all
// underscores directly. Returns null when no display name is available.
function enumLabel(displayName, literalValue) {
  if (!displayName) return null;
  const code = literalValue ? literalValue.replace(/^'|'$/g, '') : null;
  const withoutCode = code && displayName.startsWith(code + '_')
    ? displayName.slice(code.length + 1)
    : displayName;
  const label = withoutCode.replace(/_/g, ' ');
  // Suppress labels that are identical to the code — no useful information added.
  return label === code ? null : label;
}

function extractCustomTypes(root) {
  const customTypes = new Map();
  for (const annotation of asArray(root?.eAnnotations)) {
    const rootExtension = annotation?.contents;
    for (const dt of asArray(rootExtension?.customDataTypeList)) {
      const name = dt?.dataTypeName?.['@_value'];
      if (!name) continue;
      const entries = asArray(dt?.enumerationElements)
        .map((el) => ({ value: el?.value?.['@_value'], label: enumLabel(el?.label?.['@_value'], el?.value?.['@_value']) }))
        .filter((e) => e.value);
      customTypes.set(name, {
        baseType: dt?.baseDataType?.['@_value'],
        isEnum: dt?.enumeration?.['@_value'] === 'true',
        values: entries.map((e) => e.value),
        entries,
      });
    }
  }
  for (const classifier of asArray(root?.eClassifiers)) {
    if (classifier?.['@_xsi:type'] !== 'ecore:EEnum') continue;
    const name = classifier['@_name'];
    if (!name || customTypes.has(name)) continue; // customDataTypeList sibling already covers it
    const entries = asArray(classifier?.eLiterals)
      .map((lit) => ({ value: lit?.['@_literal'], label: enumLabel(lit?.['@_name'], lit?.['@_literal']) }))
      .filter((e) => e.value);
    customTypes.set(name, {
      baseType: 'String',
      isEnum: true,
      values: entries.map((e) => e.value),
      entries,
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

/**
 * Parse a Corticon Vocabulary (.ecore) file into { entities, customTypes }.
 *
 * Each entity has separate `attributes` and `references` maps, mirroring
 * Corticon's own distinction (ecore:EAttribute vs ecore:EReference):
 *   attributes:   { dataType } — scalar fields; dataType is the Corticon type name
 *                   (e.g. 'Integer', 'String', 'Boolean', 'Decimal', 'Date') or a
 *                   custom type name (e.g. 'state_name') defined in customTypes.
 *   references:   { entityType, isCollection, isRequired, opposite? } — relationships
 *                   to other entities; entityType is the simple entity class name
 *                   (e.g. 'AgEligRslt'), never the package-qualified path.
 *
 * Entities are collected by recursively walking eSubpackages — confirmed real:
 * expedited-snap's CBMSVocabulary.ecore has 965 entity classes nested under
 * DomainModel/* subpackages; only EligibilityHousehold lives at root level.
 * Corticon rules always reference entities by their simple class name regardless
 * of which subpackage they live in.
 */
function extractEntitiesFromPackage(pkg, entities, ctx, customTypes) {
  for (const classifier of asArray(pkg?.eClassifiers)) {
    if (classifier?.['@_xsi:type'] !== 'ecore:EClass') continue;
    const entityName = classifier['@_name'];
    const attributes = new Map();
    const references = new Map();
    for (const feature of asArray(classifier?.eStructuralFeatures)) {
      const featureName = feature?.['@_name'];
      if (!featureName) continue;
      const isAssociation = feature['@_xsi:type'] === 'ecore:EReference';
      const isCollection = feature['@_upperBound'] === '-1';
      const resolved = resolveEType(feature['@_eType'], ctx);
      const isTransient = asArray(feature.mode).some((m) => m?.['@_value'] === 'ExtendedTransient');

      if (isAssociation) {
        // Both confirmed real only on EReference features, never on plain attributes:
        // `eOpposite` cross-links bidirectional references (DC Medicaid's Household.person
        // <-> Person.household); `lowerBound="1"` marks a required reference.
        // resolved.name may be a package-qualified path (e.g. "DomainModel/Results/AgEligRslt")
        // when the target entity lives in a subpackage -- take only the simple class name
        // because that's what Corticon rules use in their term references.
        const entityType = resolved.name.split('/').pop();
        const ref = {
          entityType,
          isCollection,
          isRequired: feature['@_lowerBound'] === '1',
          ...(isTransient ? { isTransient: true } : {}),
        };
        const eOpposite = feature['@_eOpposite'];
        if (eOpposite) ref.opposite = eOpposite.slice(eOpposite.lastIndexOf('/') + 1);
        references.set(featureName, ref);
      } else {
        // EAttribute: dataType is the Corticon type name. A bare reference that matches
        // a customType entry is a custom data type (enum) -- its name IS its type name.
        const dataType = resolved.name;
        if (isCollection) {
          throw new Error(`"${entityName}.${featureName}" is a repeating scalar attribute (isCollection) -- no confirmed real example exists in any fixture yet, and this DSL's Fact path scheme has no established wildcard convention for one. Flagging rather than guessing at a path shape.`);
        }
        attributes.set(featureName, {
          dataType,
          ...(isTransient ? { isTransient: true } : {}),
        });
      }
    }
    entities.set(entityName, { attributes, references });
  }
  // Recurse into nested subpackages -- confirmed real: CBMSVocabulary.ecore nests all
  // 964 non-root entities under DomainModel/* subpackages.
  for (const subpkg of asArray(pkg?.eSubpackages)) {
    extractEntitiesFromPackage(subpkg, entities, ctx, customTypes);
  }
}

export function parseVocabulary(filePath) {
  const doc = parseCorticonXml(filePath);
  const root = doc['ecore:EPackage'];
  const customTypes = extractCustomTypes(root);
  const ctx = { filePath: path.resolve(filePath), baseDir: path.dirname(filePath), cache: new Map() };

  const entities = new Map();
  extractEntitiesFromPackage(root, entities, ctx, customTypes);

  return { entities, customTypes };
}
