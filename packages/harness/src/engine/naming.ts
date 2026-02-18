/**
 * Shared naming utilities for custom story management and Storybook story ID computation.
 * Used by both the form engine (ContractPreview) and story generator script.
 */

/** Replicate Storybook's ID sanitizer: lowercase, non-alphanum → hyphens, collapse. */
export function sanitize(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Convert kebab-case to PascalCase. */
export function toPascalCase(kebab: string): string {
  return kebab
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

/** Convert kebab-case to camelCase. */
export function toCamelCase(kebab: string): string {
  const pascal = toPascalCase(kebab);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/** Convert user input to kebab-case for filenames. */
export function toKebabCase(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Replicate Storybook 8.6's toStartCaseStr (aliased as storyNameFromExport).
 * Must match @storybook/core/dist/csf/index.js exactly for correct story IDs.
 */
export function storyNameFromExport(exportName: string): string {
  return exportName
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\./g, ' ')
    .replace(/([^\n])([A-Z])([a-z])/g, '$1 $2$3')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-z])([0-9])/gi, '$1 $2')
    .replace(/([0-9])([a-z])/gi, '$1 $2')
    .replace(/ +/g, ' ')
    .trim();
}

/** Build a Storybook story ID from meta.title and the story's PascalCase export name. */
export function buildStoryId(metaTitle: string, exportName: string): string {
  return `${sanitize(metaTitle)}--${sanitize(storyNameFromExport(exportName))}`;
}

/**
 * Build the custom story display name from a kebab-case name.
 * Replaces hyphens with spaces and capitalizes each word (Title Case).
 */
export function customDisplayName(customName: string): string {
  return customName
    .replace(/-/g, ' ')
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * Build the Storybook meta title for a custom story.
 * Uses the same Role/Category/Name structure as base stories.
 */
export function customMetaTitle(role: string, category: string | undefined, displayName: string): string {
  const prefix = capitalize(role);
  return category ? `${prefix}/${category}/${displayName}` : `${prefix}/${displayName}`;
}

/**
 * Compute the full Storybook story ID for a custom story.
 * @param role - e.g. "applicant"
 * @param category - e.g. "Intake" (optional)
 * @param customKebab - e.g. "texas-snap"
 */
export function customStoryId(role: string, category: string | undefined, customKebab: string): string {
  const displayName = customDisplayName(customKebab);
  const metaTitle = customMetaTitle(role, category, displayName);
  const exportName = toPascalCase(customKebab);
  return buildStoryId(metaTitle, exportName);
}

/**
 * Check if a Storybook story will auto-flatten (single story, name matches title leaf).
 * The story name must equal the last segment of the title (split by '/').
 */
export function willAutoFlatten(metaTitle: string, storyName: string): boolean {
  const segments = metaTitle.split('/');
  const leaf = segments[segments.length - 1];
  return leaf === storyName;
}
