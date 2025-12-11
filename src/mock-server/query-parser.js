/**
 * Query string parser for the `q` parameter search syntax
 *
 * Supports Elasticsearch-style search syntax:
 *   q=term                      # Full-text exact match
 *   q=*term*                    # Full-text contains
 *   q=term*                     # Full-text starts with
 *   q=*term                     # Full-text ends with
 *   q=field:value               # Exact match
 *   q=field:*value*             # Contains (case-insensitive)
 *   q=field:value*              # Starts with
 *   q=field:*value              # Ends with
 *   q=field:>value              # Greater than
 *   q=field:>=value             # Greater than or equal
 *   q=field:<value              # Less than
 *   q=field:<=value             # Less than or equal
 *   q=field:val1,val2           # Match any (OR)
 *   q=-field:value              # Exclude/negate
 *   q=field:*                   # Field exists
 *   q=-field:*                  # Field does not exist
 *   q=term1 term2               # Multiple conditions (AND)
 *   q=field.nested:value        # Nested field (dot notation)
 */

/**
 * Token types for parsed query terms
 */
export const TokenType = {
  FULL_TEXT: 'fullText',
  FULL_TEXT_CONTAINS: 'fullTextContains',
  FULL_TEXT_STARTS_WITH: 'fullTextStartsWith',
  FULL_TEXT_ENDS_WITH: 'fullTextEndsWith',
  EXACT: 'exact',
  CONTAINS: 'contains',
  STARTS_WITH: 'startsWith',
  ENDS_WITH: 'endsWith',
  GREATER_THAN: 'gt',
  GREATER_THAN_OR_EQUAL: 'gte',
  LESS_THAN: 'lt',
  LESS_THAN_OR_EQUAL: 'lte',
  IN: 'in',
  NOT_EQUAL: 'neq',
  NOT_IN: 'notIn',
  EXISTS: 'exists',
  NOT_EXISTS: 'notExists'
};

/**
 * Parse a single term from the query string
 * @param {string} term - A single term like "status:approved" or "-field:value"
 * @returns {Object} Parsed token with type, field, and value(s)
 */
export function parseTerm(term) {
  if (!term || typeof term !== 'string') {
    return null;
  }

  term = term.trim();
  if (!term) {
    return null;
  }

  // Check for negation prefix
  const isNegated = term.startsWith('-');
  if (isNegated) {
    term = term.slice(1);
  }

  // Check if this is a field:value term
  const colonIndex = term.indexOf(':');

  if (colonIndex === -1) {
    // No colon - this is a full-text search term
    // Check for wildcard patterns
    const { type: wildcardType, value: wildcardValue } = parseWildcardPattern(term, true);
    return {
      type: wildcardType,
      field: null,
      value: isNegated ? `-${wildcardValue}` : wildcardValue
    };
  }

  const field = term.slice(0, colonIndex);
  let value = term.slice(colonIndex + 1);

  // Handle existence check (field:*)
  if (value === '*') {
    return {
      type: isNegated ? TokenType.NOT_EXISTS : TokenType.EXISTS,
      field,
      value: null
    };
  }

  // Handle comparison operators
  let type = TokenType.EXACT;

  if (value.startsWith('>=')) {
    type = TokenType.GREATER_THAN_OR_EQUAL;
    value = value.slice(2);
  } else if (value.startsWith('>')) {
    type = TokenType.GREATER_THAN;
    value = value.slice(1);
  } else if (value.startsWith('<=')) {
    type = TokenType.LESS_THAN_OR_EQUAL;
    value = value.slice(2);
  } else if (value.startsWith('<')) {
    type = TokenType.LESS_THAN;
    value = value.slice(1);
  }

  // Handle comma-separated values (OR matching)
  if (value.includes(',')) {
    const values = value.split(',').map(v => v.trim()).filter(v => v);
    return {
      type: isNegated ? TokenType.NOT_IN : TokenType.IN,
      field,
      value: values
    };
  }

  // Check for wildcard patterns (only for EXACT type, not comparisons)
  if (type === TokenType.EXACT) {
    const { type: wildcardType, value: wildcardValue } = parseWildcardPattern(value, false);
    type = wildcardType;
    value = wildcardValue;

    // Apply negation to exact match
    if (isNegated && type === TokenType.EXACT) {
      type = TokenType.NOT_EQUAL;
    }
  }

  // Try to parse numeric values (only for exact match and comparisons)
  if (type === TokenType.EXACT || type === TokenType.NOT_EQUAL ||
      type === TokenType.GREATER_THAN || type === TokenType.GREATER_THAN_OR_EQUAL ||
      type === TokenType.LESS_THAN || type === TokenType.LESS_THAN_OR_EQUAL) {
    const numericValue = parseNumericValue(value);
    if (numericValue !== null) {
      value = numericValue;
    }
  }

  return {
    type,
    field,
    value
  };
}

/**
 * Parse wildcard pattern from a value
 * @param {string} value - The value to check for wildcards
 * @param {boolean} isFullText - Whether this is a full-text search term
 * @returns {Object} { type: TokenType, value: string }
 */
function parseWildcardPattern(value, isFullText) {
  const startsWithWildcard = value.startsWith('*');
  const endsWithWildcard = value.endsWith('*');

  // Remove wildcards from value
  let cleanValue = value;
  if (startsWithWildcard) {
    cleanValue = cleanValue.slice(1);
  }
  if (endsWithWildcard) {
    cleanValue = cleanValue.slice(0, -1);
  }

  // Determine type based on wildcard position
  let type;
  if (startsWithWildcard && endsWithWildcard) {
    type = isFullText ? TokenType.FULL_TEXT_CONTAINS : TokenType.CONTAINS;
  } else if (startsWithWildcard) {
    type = isFullText ? TokenType.FULL_TEXT_ENDS_WITH : TokenType.ENDS_WITH;
  } else if (endsWithWildcard) {
    type = isFullText ? TokenType.FULL_TEXT_STARTS_WITH : TokenType.STARTS_WITH;
  } else {
    type = isFullText ? TokenType.FULL_TEXT : TokenType.EXACT;
  }

  return { type, value: cleanValue };
}

/**
 * Try to parse a value as a number
 * @param {string} value - The value to parse
 * @returns {number|null} The parsed number or null if not numeric
 */
function parseNumericValue(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  // Check if it looks like a number
  const num = Number(value);
  if (!isNaN(num) && isFinite(num)) {
    return num;
  }

  return null;
}

/**
 * Parse the full query string into an array of tokens
 * @param {string} queryString - The full q parameter value
 * @returns {Array} Array of parsed tokens
 */
export function parseQueryString(queryString) {
  if (!queryString || typeof queryString !== 'string') {
    return [];
  }

  const tokens = [];

  // Split by whitespace, but preserve quoted strings
  const terms = splitQueryTerms(queryString);

  for (const term of terms) {
    const token = parseTerm(term);
    if (token) {
      tokens.push(token);
    }
  }

  return tokens;
}

/**
 * Split query string into terms, respecting quoted strings
 * @param {string} queryString - The query string to split
 * @returns {Array<string>} Array of terms
 */
function splitQueryTerms(queryString) {
  const terms = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = null;

  for (let i = 0; i < queryString.length; i++) {
    const char = queryString[i];

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = null;
    } else if (char === ' ' && !inQuotes) {
      if (current.trim()) {
        terms.push(current.trim());
      }
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    terms.push(current.trim());
  }

  return terms;
}

/**
 * Convert parsed tokens to SQL WHERE clauses for SQLite with JSON
 * @param {Array} tokens - Parsed query tokens
 * @param {Array} searchableFields - Fields to search for full-text queries
 * @returns {Object} { whereClauses: Array<string>, params: Array }
 */
export function tokensToSqlConditions(tokens, searchableFields = []) {
  const whereClauses = [];
  const params = [];

  for (const token of tokens) {
    const { clause, tokenParams } = tokenToSqlCondition(token, searchableFields);
    if (clause) {
      whereClauses.push(clause);
      params.push(...tokenParams);
    }
  }

  return { whereClauses, params };
}

/**
 * Convert a single token to a SQL condition
 * @param {Object} token - Parsed token
 * @param {Array} searchableFields - Fields to search for full-text queries
 * @returns {Object} { clause: string, tokenParams: Array }
 */
function tokenToSqlCondition(token, searchableFields) {
  const { type, field, value } = token;

  switch (type) {
    // Full-text search types (search across multiple fields)
    case TokenType.FULL_TEXT: {
      if (searchableFields.length === 0) {
        return { clause: null, tokenParams: [] };
      }
      // Exact match across searchable fields
      const clauses = searchableFields.map(f =>
        `LOWER(COALESCE(json_extract(data, '$.${f}'), '')) = LOWER(?)`
      );
      return {
        clause: `(${clauses.join(' OR ')})`,
        tokenParams: searchableFields.map(() => value)
      };
    }

    case TokenType.FULL_TEXT_CONTAINS: {
      if (searchableFields.length === 0) {
        return { clause: null, tokenParams: [] };
      }
      const clauses = searchableFields.map(f =>
        `LOWER(COALESCE(json_extract(data, '$.${f}'), '')) LIKE LOWER(?)`
      );
      const pattern = `%${value}%`;
      return {
        clause: `(${clauses.join(' OR ')})`,
        tokenParams: searchableFields.map(() => pattern)
      };
    }

    case TokenType.FULL_TEXT_STARTS_WITH: {
      if (searchableFields.length === 0) {
        return { clause: null, tokenParams: [] };
      }
      const clauses = searchableFields.map(f =>
        `LOWER(COALESCE(json_extract(data, '$.${f}'), '')) LIKE LOWER(?)`
      );
      const pattern = `${value}%`;
      return {
        clause: `(${clauses.join(' OR ')})`,
        tokenParams: searchableFields.map(() => pattern)
      };
    }

    case TokenType.FULL_TEXT_ENDS_WITH: {
      if (searchableFields.length === 0) {
        return { clause: null, tokenParams: [] };
      }
      const clauses = searchableFields.map(f =>
        `LOWER(COALESCE(json_extract(data, '$.${f}'), '')) LIKE LOWER(?)`
      );
      const pattern = `%${value}`;
      return {
        clause: `(${clauses.join(' OR ')})`,
        tokenParams: searchableFields.map(() => pattern)
      };
    }

    // Field-specific types
    case TokenType.EXACT: {
      const jsonPath = fieldToJsonPath(field);
      return {
        clause: `json_extract(data, '${jsonPath}') = ?`,
        tokenParams: [value]
      };
    }

    case TokenType.CONTAINS: {
      const jsonPath = fieldToJsonPath(field);
      return {
        clause: `LOWER(COALESCE(json_extract(data, '${jsonPath}'), '')) LIKE LOWER(?)`,
        tokenParams: [`%${value}%`]
      };
    }

    case TokenType.STARTS_WITH: {
      const jsonPath = fieldToJsonPath(field);
      return {
        clause: `LOWER(COALESCE(json_extract(data, '${jsonPath}'), '')) LIKE LOWER(?)`,
        tokenParams: [`${value}%`]
      };
    }

    case TokenType.ENDS_WITH: {
      const jsonPath = fieldToJsonPath(field);
      return {
        clause: `LOWER(COALESCE(json_extract(data, '${jsonPath}'), '')) LIKE LOWER(?)`,
        tokenParams: [`%${value}`]
      };
    }

    case TokenType.NOT_EQUAL: {
      const jsonPath = fieldToJsonPath(field);
      return {
        clause: `(json_extract(data, '${jsonPath}') IS NULL OR json_extract(data, '${jsonPath}') != ?)`,
        tokenParams: [value]
      };
    }

    case TokenType.GREATER_THAN: {
      const jsonPath = fieldToJsonPath(field);
      return {
        clause: `CAST(json_extract(data, '${jsonPath}') AS REAL) > ?`,
        tokenParams: [value]
      };
    }

    case TokenType.GREATER_THAN_OR_EQUAL: {
      const jsonPath = fieldToJsonPath(field);
      return {
        clause: `CAST(json_extract(data, '${jsonPath}') AS REAL) >= ?`,
        tokenParams: [value]
      };
    }

    case TokenType.LESS_THAN: {
      const jsonPath = fieldToJsonPath(field);
      return {
        clause: `CAST(json_extract(data, '${jsonPath}') AS REAL) < ?`,
        tokenParams: [value]
      };
    }

    case TokenType.LESS_THAN_OR_EQUAL: {
      const jsonPath = fieldToJsonPath(field);
      return {
        clause: `CAST(json_extract(data, '${jsonPath}') AS REAL) <= ?`,
        tokenParams: [value]
      };
    }

    case TokenType.IN: {
      const jsonPath = fieldToJsonPath(field);
      // Check if the field value matches any of the provided values
      // OR if the field is an array, check if any array element matches
      const placeholders = value.map(() => '?').join(', ');
      const directMatch = `json_extract(data, '${jsonPath}') IN (${placeholders})`;
      const arrayMatch = value.map(() =>
        `EXISTS (SELECT 1 FROM json_each(json_extract(data, '${jsonPath}')) WHERE value = ?)`
      ).join(' OR ');

      return {
        clause: `(${directMatch} OR ${arrayMatch})`,
        tokenParams: [...value, ...value]
      };
    }

    case TokenType.NOT_IN: {
      const jsonPath = fieldToJsonPath(field);
      const placeholders = value.map(() => '?').join(', ');
      return {
        clause: `(json_extract(data, '${jsonPath}') IS NULL OR json_extract(data, '${jsonPath}') NOT IN (${placeholders}))`,
        tokenParams: value
      };
    }

    case TokenType.EXISTS: {
      const jsonPath = fieldToJsonPath(field);
      return {
        clause: `json_extract(data, '${jsonPath}') IS NOT NULL`,
        tokenParams: []
      };
    }

    case TokenType.NOT_EXISTS: {
      const jsonPath = fieldToJsonPath(field);
      return {
        clause: `json_extract(data, '${jsonPath}') IS NULL`,
        tokenParams: []
      };
    }

    default:
      return { clause: null, tokenParams: [] };
  }
}

/**
 * Convert a field name (potentially with dot notation) to a JSON path
 * @param {string} field - Field name like "name.firstName" or "status"
 * @returns {string} JSON path like "$.name.firstName" or "$.status"
 */
function fieldToJsonPath(field) {
  // Already has $ prefix
  if (field.startsWith('$')) {
    return field;
  }
  return `$.${field}`;
}
