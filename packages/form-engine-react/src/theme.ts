import dsConfig from '../ds.config.json';

/**
 * Component roles that the design system can apply classes to.
 * Each key corresponds to a @trussworks/react-uswds component.
 */
const COMPONENT_ROLES = [
  'form',
  'formGroup',
  'label',
  'input',
  'select',
  'fieldset',
  'radio',
  'checkbox',
  'button',
  'accordion',
] as const;

type ComponentRole = (typeof COMPONENT_ROLES)[number];

export type DsClassMap = Record<ComponentRole, string>;

/**
 * Convert a camelCase role name to kebab-case for class generation.
 * e.g. "formGroup" → "form-group"
 */
function toKebab(role: string): string {
  return role.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

/**
 * Build the class map from ds.config.json.
 *
 * 1. If classPrefix is set, generate "{prefix}-{kebab-role}" for each role.
 *    If classPrefix is empty, all generated values are empty strings.
 * 2. Merge any classOverrides on top — overrides win unconditionally.
 */
function buildClassMap(): DsClassMap {
  const prefix: string = dsConfig.classPrefix ?? '';
  const overrides: Partial<DsClassMap> =
    (dsConfig as Record<string, unknown>).classOverrides as Partial<DsClassMap> ?? {};

  const generated = Object.fromEntries(
    COMPONENT_ROLES.map((role) => [
      role,
      prefix ? `${prefix}-${toKebab(role)}` : '',
    ]),
  ) as DsClassMap;

  return { ...generated, ...overrides };
}

/**
 * Active design-system class map.
 *
 * Generated at build time from ds.config.json.  Components use `ds.input`,
 * `ds.button`, etc. to append the design system's required CSS classes.
 *
 * With classPrefix "cfa":  ds.input → "cfa-input", ds.formGroup → "cfa-form-group"
 * With classPrefix "":     ds.input → "",          ds.formGroup → ""
 */
export const ds: DsClassMap = buildClassMap();
