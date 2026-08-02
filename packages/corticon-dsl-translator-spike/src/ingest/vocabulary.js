import { parseCorticonXml, asArray } from './xml.js';

const ECORE_TYPE_MAP = {
  EString: 'String',
  ELongObject: 'Integer',
  EIntegerObject: 'Integer',
  EDoubleObject: 'Decimal',
  EBooleanObject: 'Boolean',
  EBigDecimal: 'Decimal',
};

function resolveEType(eType) {
  if (!eType) return { kind: 'unknown', name: eType };
  const hashIndex = eType.lastIndexOf('#//');
  const localName = hashIndex >= 0 ? eType.slice(hashIndex + 3) : eType;
  if (eType.includes('Ecore#//')) {
    return { kind: 'primitive', name: ECORE_TYPE_MAP[localName] ?? localName };
  }
  if (eType.includes('canonicalvocabularymodel.ecore#//')) {
    // Corticon's own base types beyond plain Ecore primitives (e.g. Date, Time, DateTime).
    return { kind: 'primitive', name: localName };
  }
  // A bare `#//Name` reference is either a custom data type (enum) defined in this
  // same Vocabulary file, or another entity (for an EReference/association) — the
  // caller disambiguates using which one actually resolves.
  return { kind: 'reference', name: localName };
}

/** Parse a Corticon Vocabulary (.ecore) file into { entities, customTypes }. */
export function parseVocabulary(filePath) {
  const doc = parseCorticonXml(filePath);
  const root = doc['ecore:EPackage'];

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
      const resolved = resolveEType(feature['@_eType']);
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
