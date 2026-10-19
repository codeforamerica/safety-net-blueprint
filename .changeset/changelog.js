/**
 * How release notes are written: each changeset's text as its author wrote
 * it, and one line naming the versions of the blueprint packages a release
 * depends on.
 *
 * Changesets' default writer prefixed every entry with a commit hash and
 * wrote one "Updated dependencies [<hash>]" line for every changeset behind a
 * dependency's bump. Neither tells a reader anything. Set as `changelog` in
 * config.json.
 */

/** A changeset's entry: its summary, later lines indented under the first. */
export function getReleaseLine(changeset) {
  const [first, ...rest] = changeset.summary.split('\n').map((line) => line.trimEnd());
  return [`- ${first}`, ...rest.map((line) => (line ? `  ${line}` : line))].join('\n');
}

/** One line for the blueprint packages this release moves to new versions of. */
export function getDependencyReleaseLine(changesets, dependenciesUpdated) {
  if (dependenciesUpdated.length === 0) return '';
  return `- Uses ${dependenciesUpdated.map((d) => `${d.name} ${d.newVersion}`).join(', ')}.`;
}

export default { getReleaseLine, getDependencyReleaseLine };
