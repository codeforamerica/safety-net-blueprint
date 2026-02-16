import type { FieldDefinition, PermissionLevel, Role, PermissionsPolicy } from './types';

/**
 * Resolves the permission level for a field.
 *
 * Resolution order:
 * 1. Permissions policy field override (if policy provided)
 * 2. Permissions policy default (if policy provided)
 * 3. Inline field permissions (legacy/fallback)
 * 4. 'editable' (default)
 */
export function resolvePermission(
  field: FieldDefinition,
  role: Role,
  policy?: PermissionsPolicy,
): PermissionLevel {
  if (policy) {
    // Field-level override in policy
    const fieldKey = field.ref.split('.').pop() ?? field.ref;
    if (policy.fields?.[field.ref]) {
      return policy.fields[field.ref];
    }
    if (policy.fields?.[fieldKey]) {
      return policy.fields[fieldKey];
    }
    // Policy default
    return policy.defaults;
  }

  // Fallback: inline field permissions
  if (field.permissions) {
    return field.permissions[role] ?? 'editable';
  }

  return 'editable';
}
