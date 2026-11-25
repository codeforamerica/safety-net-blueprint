/**
 * Require the caller's sign-in on every domain API.
 *
 * How a caller signs in is the contract set's, chosen per state and per
 * environment: the schemes in `base/components/security-schemes.yaml`, which
 * a state's overlays change and whose `x-environments` and `${VAR}`s differ
 * by environment. The framework's default is `callerId`, the `X-Caller-Id`
 * header. This pass runs after the environment's are applied, so it sees the
 * schemes that environment has, and makes every domain API require them:
 *
 *   - an OpenAPI document's top-level `security` lists each scheme as an
 *     alternative, so a caller signs in with any one of them;
 *   - its `components.securitySchemes` has a `$ref` to each, since a
 *     requirement's names are read from the document's own components.
 *
 * An operation that names the default scheme in its own `security`, such as
 * the transcription session adapter's `requestCredentials`, gets the same
 * alternatives. An operation's other `security`, such as `[]` for a public
 * one, or a scheme of the API's own, is left as written.
 *
 * AsyncAPI documents are left alone. Events from outside the server arrive
 * through `publishEvent`, an OpenAPI operation that already requires these
 * schemes. AsyncAPI security describes connecting to a broker, and its scheme
 * types differ from OpenAPI's (`httpApiKey` rather than `apiKey`), so it
 * can't refer to the shared schemes.
 *
 * A top-level `security` the author wrote that names a scheme of the API's
 * own is left as written, for validation to report (top-level-security):
 * replacing it would hide the mistake.
 *
 * An adapter's API gets no top-level requirement: what calls it is the
 * blueprint's own runtime, such as a session in the page, not a person. With
 * no shared schemes left in an environment, nothing requires sign-in there.
 */

import { normalizeRefPath } from '../ref-lookup.js';

/** Where the shared schemes are, in the contract set and by their canonical address. */
const SHARED_PATH = 'base/components/security-schemes.yaml';
const SHARED_URI = 'https://blueprint.codeforamerica.org/base/components/security-schemes.yaml';

/** The scheme an authored requirement names to mean the caller's sign-in. */
export const DEFAULT_SCHEME = 'callerId';

/** The shared schemes' names, in the set: the keys that are schemes, not annotations. */
export function sharedSchemes(docs) {
  const shared = docs.find((doc) => doc.relativePath === SHARED_PATH);
  return Object.entries(shared?.content ?? {})
    .filter(([name, scheme]) => !name.startsWith('x-') && scheme && typeof scheme === 'object' && typeof scheme.type === 'string')
    .map(([name]) => name);
}

/** A requirement for each shared scheme, as alternatives. */
const requirementFor = (names) => names.map((name) => ({ [name]: [] }));

/** Whether one requirement is the default scheme. */
const isDefault = (requirement) => Boolean(requirement) && DEFAULT_SCHEME in requirement;

/** Whether a requirement list names the default scheme, which means the caller's sign-in. */
const namesDefault = (security) => Array.isArray(security) && security.some(isDefault);

/** A domain API: an OpenAPI document of a domain that isn't an adapter's. */
const isDomainApi = (doc) => doc.type === 'openapi'
  && doc.content?.['x-relationship']?.type !== 'external'
  && Boolean(doc.content?.info?.['x-domain']);

/**
 * Whether a `$ref` points at the shared schemes: by their canonical address,
 * as an authored document writes it, or by a path relative to the document,
 * as resolve writes it out.
 */
const refersToShared = (scheme, from) => {
  const ref = scheme?.$ref;
  if (typeof ref !== 'string' || !ref.includes('#/')) return false;
  const [file] = ref.split('#');
  return file === SHARED_URI || normalizeRefPath(file, from) === SHARED_PATH;
};

/**
 * A `$ref` to a shared scheme from a document: relative to it, as resolve
 * writes references out, so it resolves where the set has no canonical
 * addresses to look up, as in a page.
 */
const sharedRef = (name, from) => {
  const fromDir = from?.includes('/') ? from.slice(0, from.lastIndexOf('/')).split('/') : [];
  const target = SHARED_PATH.split('/');
  let common = 0;
  while (common < fromDir.length && fromDir[common] === target[common]) common++;
  const path = [...fromDir.slice(common).map(() => '..'), ...target.slice(common)].join('/');
  return { $ref: `${from ? path : SHARED_URI}#/${name}` };
};

/**
 * @param {import('../../types.js').Doc[]} docs
 * @returns {{ docs: object[], warnings: string[], applied: string[] }}
 */
export function requireSignIn(docs) {
  const names = sharedSchemes(docs);
  const applied = [];

  const result = docs.map((doc) => {
    if (doc.type !== 'openapi') return doc;
    const content = doc.content;
    if (!content || typeof content !== 'object') return doc;

    const from = doc.relativePath;
    const operations = operationsOf(doc);
    const expanding = operations.some((operation) => namesDefault(operation.security));
    const written = Array.isArray(content.security) && content.security.some((requirement) => Object.keys(requirement ?? {})
      .some((name) => !refersToShared(content.components?.securitySchemes?.[name], from)));
    const requiring = isDomainApi(doc) && names.length > 0 && !written;
    const sharedRefs = Object.values(content.components?.securitySchemes ?? {}).some((scheme) => refersToShared(scheme, from));
    if (!expanding && !requiring && !sharedRefs) return doc;

    const next = structuredClone(content);
    // The document's own schemes stay; references to the shared ones become
    // the environment's.
    const own = Object.fromEntries(Object.entries(next.components?.securitySchemes ?? {}).filter(([, scheme]) => !refersToShared(scheme, from)));
    const used = requiring || expanding ? names.filter((name) => !(name in own)) : [];
    const schemes = { ...own, ...Object.fromEntries(used.map((name) => [name, sharedRef(name, from)])) };
    if (Object.keys(schemes).length) {
      next.components = { ...next.components, securitySchemes: schemes };
    } else if (next.components) {
      delete next.components.securitySchemes;
    }
    if (requiring) next.security = requirementFor(names);
    for (const operation of operationsOf({ ...doc, content: next })) {
      if (!namesDefault(operation.security)) continue;
      const others = operation.security.filter((requirement) => !isDefault(requirement));
      operation.security = [...requirementFor(names), ...others];
    }
    applied.push(`Required ${names.length ? names.join(' or ') : 'no sign-in'} -> ${doc.relativePath ?? doc.path}`);
    return { ...doc, content: next };
  });

  return { docs: result, warnings: [], applied };
}

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** Each operation object of an OpenAPI document, to read or change in place. */
function operationsOf(doc) {
  return Object.values(doc.content?.paths ?? {}).flatMap((item) => METHODS.map((method) => item?.[method]).filter(Boolean));
}
