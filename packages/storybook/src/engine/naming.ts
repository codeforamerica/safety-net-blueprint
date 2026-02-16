/**
 * Shared naming utilities for scenario management and Storybook story ID computation.
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

/**
 * Replicate Storybook's storyNameFromExport.
 * Splits at camelCase boundaries and letter-digit boundaries.
 */
export function storyNameFromExport(exportName: string): string {
  return exportName
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

/** Build a Storybook story ID from meta.title and the story's PascalCase export name. */
export function buildStoryId(metaTitle: string, exportName: string): string {
  return `${sanitize(metaTitle)}--${sanitize(storyNameFromExport(exportName))}`;
}

/**
 * Build the scenario display name from a kebab-case scenario name.
 * Replaces hyphens with spaces — no forced capitalization.
 */
export function scenarioDisplayName(scenarioName: string): string {
  return scenarioName.replace(/-/g, ' ');
}

/**
 * Build the Storybook meta title for a scenario story.
 * Must produce a title whose last segment matches the story name for auto-flattening.
 */
export function scenarioMetaTitle(formTitle: string, displayName: string): string {
  return `Scenarios/${formTitle}: ${displayName}`;
}

/**
 * Build the Storybook story name for a scenario story.
 * Must match the last segment of the meta title for auto-flattening.
 */
export function scenarioStoryName(formTitle: string, displayName: string): string {
  return `${formTitle}: ${displayName}`;
}

/**
 * Compute the full Storybook story ID for a scenario.
 * @param formTitle - e.g. "Person Review"
 * @param scenarioKebab - e.g. "mary-hamlin"
 */
export function scenarioStoryId(formTitle: string, scenarioKebab: string): string {
  const displayName = scenarioDisplayName(scenarioKebab);
  const metaTitle = scenarioMetaTitle(formTitle, displayName);
  const exportName = toPascalCase(scenarioKebab);
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
