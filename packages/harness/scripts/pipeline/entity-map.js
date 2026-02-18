/**
 * Shared configuration for the CSV-to-overlay pipeline.
 *
 * Defines entity hierarchy, field groupings, type mappings, program column
 * maps, and annotation path prefixes used by all pipeline steps.
 */

// ─── Entity hierarchy ────────────────────────────────────────────────────────
// Only entities that appear in the storybook's scoped model.
// Application → Household (1:1) → Person[] (1:N) → Income[], Asset[], Expense[] (0:N each)

export const INCLUDED_ENTITIES = [
  'Application',
  'Household',
  'Person',
  'Income',
  'Asset',
  'Expense',
];

export const ENTITY_RELATIONSHIPS = {
  Application: {
    household: { type: 'object', ref: 'Household' },
  },
  Household: {
    members: { type: 'array', ref: 'Person' },
  },
  Person: {
    incomes: { type: 'array', ref: 'Income' },
    assets: { type: 'array', ref: 'Asset' },
    expenses: { type: 'array', ref: 'Expense' },
  },
};

// ─── System / infrastructure fields to skip ──────────────────────────────────

export const SYSTEM_FIELDS = new Set([
  'id', 'createdAt', 'updatedAt',
  'applicationId', 'householdId', 'personId',
]);

// ─── Household field groupings ───────────────────────────────────────────────
// CSV uses flat names like physicalStreet1; OpenAPI nests them under sub-objects.

export const HOUSEHOLD_PREFIX_GROUPS = {
  physical:    'physicalAddress',
  mailing:     'mailingAddress',
  shelterCost: 'shelterCosts',
  utilityCost: 'utilityCosts',
};

/**
 * Given a Household field name from the CSV, return { group, subField } if it
 * belongs to a prefix group, or null if it's a top-level field.
 *
 * e.g. "physicalStreet1" → { group: "physicalAddress", subField: "street1" }
 *      "shelterCostRent" → { group: "shelterCosts", subField: "rent" }
 */
export function resolveHouseholdGroup(fieldName) {
  for (const [prefix, group] of Object.entries(HOUSEHOLD_PREFIX_GROUPS)) {
    if (fieldName.startsWith(prefix) && fieldName.length > prefix.length) {
      // Strip prefix, lowercase first char of remainder
      const remainder = fieldName.slice(prefix.length);
      const subField = remainder.charAt(0).toLowerCase() + remainder.slice(1);
      return { group, subField };
    }
  }
  return null;
}

// ─── DataType → OpenAPI type mapping ─────────────────────────────────────────

export function csvTypeToOpenAPI(dataType, enumValues) {
  switch ((dataType || '').toLowerCase()) {
    case 'string':
    case 'text':
      return { type: 'string' };
    case 'boolean':
      return { type: 'boolean' };
    case 'integer':
      return { type: 'integer' };
    case 'number':
      return { type: 'number' };
    case 'date':
      return { type: 'string', format: 'date' };
    case 'datetime':
      return { type: 'string', format: 'date-time' };
    case 'uuid':
      return { type: 'string', format: 'uuid' };
    case 'enum': {
      const values = (enumValues || '').split('|').map(v => v.trim()).filter(Boolean);
      return { type: 'string', enum: values };
    }
    case 'enum[]': {
      const values = (enumValues || '').split('|').map(v => v.trim()).filter(Boolean);
      return { type: 'array', items: { type: 'string', enum: values } };
    }
    default:
      return { type: 'string' };
  }
}

// ─── Federal program columns → x-extension keys ─────────────────────────────

export const FEDERAL_PROGRAM_MAP = {
  'SNAP':              'x-snap',
  'Medicaid (MAGI)':   'x-medicaid-magi',
  'Medicaid (Non-MAGI)': 'x-medicaid-non-magi',
  'TANF':              'x-tanf',
  'SSI':               'x-ssi',
  'WIC':               'x-wic',
  'CHIP':              'x-chip',
  'Section 8 Housing': 'x-section-8-housing',
  'LIHEAP':            'x-liheap',
  'Summer EBT':        'x-summer-ebt',
};

export const FEDERAL_PROGRAM_COLUMNS = Object.keys(FEDERAL_PROGRAM_MAP);

// ─── California program columns → x-extension keys ──────────────────────────

export const CA_PROGRAM_MAP = {
  'CalFresh':          'x-calfresh',
  'Medi-Cal (MAGI)':   'x-medi-cal-magi',
  'Medi-Cal (Non-MAGI)': 'x-medi-cal-non-magi',
  'CalWORKs':          'x-calworks',
  'SSI/SSP':           'x-ssi-ssp',
  'California WIC':    'x-california-wic',
  'Medi-Cal (Children)': 'x-medi-cal-children',
  'Section 8 Housing': 'x-ca-section-8-housing',
  'CA LIHEAP':         'x-ca-liheap',
  'SUN Bucks':         'x-sun-bucks',
  'CAPI':              'x-capi',
  'CFAP':              'x-cfap',
  'GA/GR':             'x-ga-gr',
};

export const CA_PROGRAM_COLUMNS = Object.keys(CA_PROGRAM_MAP);

// ─── Colorado program columns → x-extension keys ─────────────────────────────

export const CO_PROGRAM_MAP = {
  'CO SNAP':              'x-co-snap',
  'Health First Colorado (MAGI)': 'x-health-first-co-magi',
  'Health First Colorado (Non-MAGI)': 'x-health-first-co-non-magi',
  'Colorado Works':       'x-colorado-works',
  'SSI':                  'x-co-ssi',
  'Colorado WIC':         'x-colorado-wic',
  'CHP+':                 'x-chp-plus',
  'Section 8 Housing':    'x-co-section-8',
  'LEAP':                 'x-leap',
  'Colorado Summer EBT':  'x-co-summer-ebt',
  'OAP':                  'x-oap',
  'AND':                  'x-and',
  'AB':                   'x-ab',
  'CCCAP':                'x-cccap',
};

export const CO_PROGRAM_COLUMNS = Object.keys(CO_PROGRAM_MAP);

// ─── Annotation dot-path prefixes ────────────────────────────────────────────
// Maps entity name to the prefix used in form-engine dot-paths.

export const ANNOTATION_PATH_PREFIX = {
  Application: '',
  Household:   'household',
  Person:      'household.members',
  Income:      'household.members.incomes',
  Asset:       'household.members.assets',
  Expense:     'household.members.expenses',
};

/**
 * Build the annotation dot-path for a field.
 * For Household grouped fields, uses the group prefix (e.g. "household.shelterCosts.rent").
 */
export function annotationPath(entity, fieldName) {
  const prefix = ANNOTATION_PATH_PREFIX[entity];
  if (prefix === undefined) return null; // entity not in scope

  if (entity === 'Household') {
    const grouped = resolveHouseholdGroup(fieldName);
    if (grouped) {
      return prefix
        ? `${prefix}.${grouped.group}.${grouped.subField}`
        : `${grouped.group}.${grouped.subField}`;
    }
  }

  return prefix ? `${prefix}.${fieldName}` : fieldName;
}

/**
 * Build the OpenAPI JSONPath for a field's property.
 * For Household grouped fields, targets the sub-object property.
 */
export function openapiFieldPath(entity, fieldName) {
  if (entity === 'Household') {
    const grouped = resolveHouseholdGroup(fieldName);
    if (grouped) {
      return `$.components.schemas.${entity}.properties.${grouped.group}.properties.${grouped.subField}`;
    }
  }
  return `$.components.schemas.${entity}.properties.${fieldName}`;
}
