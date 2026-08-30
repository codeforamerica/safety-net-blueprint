/**
 * Deep merge utility for PATCH operations
 * Merges source into target, preserving readOnly fields
 */

/**
 * Deep merge two objects
 * @param {Object} target - The target object (existing resource)
 * @param {Object} source - The source object (patch data)
 * @param {string[]} readOnlyFields - Fields that should never be overwritten
 * @returns {Object} Merged object
 */
export function deepMerge(target, source, readOnlyFields = ['id', 'createdAt']) {
  if (!target || typeof target !== 'object') {
    return source;
  }
  
  if (!source || typeof source !== 'object') {
    return target;
  }
  
  const result = { ...target };
  
  for (const [key, value] of Object.entries(source)) {
    // Skip readOnly fields
    if (readOnlyFields.includes(key)) {
      continue;
    }
    
    // If source value is null, set it (explicit null)
    if (value === null) {
      result[key] = null;
      continue;
    }
    
    // If source value is undefined, skip it
    if (value === undefined) {
      continue;
    }
    
    // If value is an array, replace the entire array (don't merge arrays)
    if (Array.isArray(value)) {
      result[key] = [...value];
      continue;
    }
    
    // If value is an object, recursively merge.
    // readOnlyFields applies only at the top level — at nested levels, an `id`
    // field is the FK on an embedded expanded reference and MUST be writable.
    // See issue #341.
    if (typeof value === 'object') {
      result[key] = deepMerge(result[key] || {}, value, []);
      continue;
    }
    
    // For primitive values, just overwrite
    result[key] = value;
  }
  
  return result;
}
