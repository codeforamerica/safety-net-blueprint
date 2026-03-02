/** Derive a human-readable label from a dotted field ref. */
export function labelFromRef(ref: string): string {
  const last = ref.split('.').pop() ?? ref;
  // camelCase → Title Case
  return last
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

/** Strip numeric indices from a qualified ref (e.g. household.members.0.ssn → household.members.ssn). */
export function stripIndices(ref: string): string {
  return ref.replace(/\.\d+/g, '');
}
