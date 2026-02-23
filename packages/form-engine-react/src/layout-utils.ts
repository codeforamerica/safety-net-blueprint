import type { FormLayout, LayoutConfig } from './types';

/**
 * Extract a LayoutConfig from a FormLayout value.
 *
 * FormLayout is always a LayoutConfig object — this function is a
 * stable API point that passes through unchanged.
 */
export function resolveLayout(layout: FormLayout): LayoutConfig {
  return layout;
}
