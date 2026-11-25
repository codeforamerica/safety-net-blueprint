/**
 * Signing in, where a call needs it.
 *
 * An operation that requires a security scheme (its `security`, or its
 * document's) needs the visitor signed in when something other than the mock
 * answers it: a service at a URL or a site's handler, as an adapter's
 * credentials request is. The scheme says how: OAuth 2.0's implicit or
 * authorization code flow, or OpenID Connect, whose discovery document names
 * the provider's endpoints. The site's config.yaml says who signs in
 * (sign_in: its client id, scopes and more parameters), which the build puts
 * on each page (lib/control-panel.js). Signing in opens the provider's page in
 * a popup, which returns to the site's sign-in-return.html; the page keeps
 * the token for the browser tab, and a reload forgets it, as it does the
 * records. A scheme with no way to sign in declared, such as a plain bearer
 * token, isn't signed in to: its calls go without one.
 *
 * This is how Swagger UI's Authorize works with its initOAuth settings.
 */

const keyFor = (scope) => `blueprint-mock-sign-in:${scope}`;

import { extract } from '@codeforamerica/blueprint-core/browser';
import { currentEnvironment } from './environments.js';

/**
 * The site's sign_in settings: the picked environment's, for a site that
 * lists environments (environments.js); otherwise from the page. Null when it
 * has none.
 */
export function signInSettings() {
  const environment = currentEnvironment();
  if (environment) return environment.sign_in ?? null;
  try {
    const node = document.getElementById('blueprint-sign-in');
    return node ? JSON.parse(node.textContent) : null;
  } catch { return null; }
}

/** Who is signed in, for the tab: `{ accessToken, name, expiresAt }`, or null. */
export function signedIn({ scope }) {
  try {
    const kept = JSON.parse(sessionStorage.getItem(keyFor(scope)) ?? 'null');
    if (!kept?.accessToken) return null;
    if (kept.expiresAt && Date.parse(kept.expiresAt) <= Date.now()) return null;
    return kept;
  } catch { return null; }
}

/** Sign out, for the tab. */
export function signOut({ scope }) {
  try { sessionStorage.removeItem(keyFor(scope)); } catch { /* nothing kept */ }
  dispatchEvent(new Event('blueprint-sign-in'));
}

const keep = ({ scope }, token) => {
  try { sessionStorage.setItem(keyFor(scope), JSON.stringify(token)); } catch { /* kept for this page only */ }
  // The page's header says who's signed in (lib/control-panel.js).
  dispatchEvent(new Event('blueprint-sign-in'));
};

/** A same-document `$ref` followed, or one into another document of the set. */
const followed = (doc, node, docs) => {
  if (typeof node?.$ref !== 'string') return node;
  if (node.$ref.startsWith('#/')) return node.$ref.slice(2).split('/').reduce((at, key) => at?.[key], doc.content);
  return doc.resolveRef(node.$ref, docs);
};

/** Whether a scheme says how to sign in. */
const signsIn = (scheme) => scheme?.type === 'openIdConnect'
  || (scheme?.type === 'oauth2' && Boolean(scheme.flows?.authorizationCode || scheme.flows?.implicit));

/**
 * The scheme an operation needs the visitor signed in with, or null: none
 * required, or none that says how to sign in.
 *
 * @param {object} doc - The operation's document
 * @param {object} operation
 * @param {object[]} docs
 */
export function schemeFor(doc, operation, docs) {
  const required = operation?.security ?? doc.content?.security ?? [];
  for (const requirement of required) {
    for (const name of Object.keys(requirement ?? {})) {
      const scheme = followed(doc, doc.content?.components?.securitySchemes?.[name], docs);
      if (signsIn(scheme)) return scheme;
    }
  }
  return null;
}

/** The first scheme in the contract set that says how to sign in, for the control panel's Sign in. */
export function anyScheme(docs) {
  for (const doc of docs.filter((d) => d.type === 'openapi')) {
    for (const node of Object.values(doc.content?.components?.securitySchemes ?? {})) {
      const scheme = followed(doc, node, docs);
      if (signsIn(scheme)) return scheme;
    }
  }
  return null;
}

/** A name for who signed in, from the token's claims when it's a JWT. */
function nameOf(token) {
  try {
    const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return claims.name ?? claims.preferred_username ?? claims.username ?? claims.email ?? claims.sub ?? 'signed in';
  } catch { return 'signed in'; }
}

const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Sign in through a scheme, in a popup. Opened from a click, as a browser
 * requires of a popup.
 *
 * @param {object} scheme - One schemeFor or anyScheme gave
 * @param {{ scope: string }} where - The mock's folder, beside the site's root
 * @returns {Promise<{ accessToken: string, name: string, expiresAt: string|null }>}
 */
export async function signIn(scheme, where) {
  const settings = signInSettings();
  if (!settings?.client_id) throw new Error('this site has no sign_in in its config.yaml');
  const site = new URL('../', where.scope);
  const returnTo = new URL('sign-in-return.html', site).href;
  // The popup opens now, while the click still counts, and is pointed at the provider once it's known.
  const popup = window.open('about:blank', 'blueprint-sign-in', 'width=480,height=640');
  if (!popup) throw new Error('the browser blocked the sign-in window');
  try {
    let authorizationUrl;
    let tokenUrl = null;
    let scopes = settings.scopes ?? [];
    if (scheme.type === 'openIdConnect') {
      const discovery = await (await fetch(new URL(scheme.openIdConnectUrl, site))).json();
      authorizationUrl = discovery.authorization_endpoint;
      tokenUrl = discovery.token_endpoint;
      scopes = [...new Set(['openid', ...scopes])];
    } else if (scheme.flows.authorizationCode) {
      authorizationUrl = scheme.flows.authorizationCode.authorizationUrl;
      tokenUrl = scheme.flows.authorizationCode.tokenUrl;
    } else {
      authorizationUrl = scheme.flows.implicit.authorizationUrl;
    }
    const state = crypto.randomUUID();
    const url = new URL(authorizationUrl, site);
    const query = {
      response_type: tokenUrl ? 'code' : 'token',
      client_id: settings.client_id,
      redirect_uri: returnTo,
      state,
      ...(scopes.length ? { scope: scopes.join(' ') } : {}),
      ...(settings.parameters ?? {}),
    };
    let verifier = null;
    if (tokenUrl) {
      // PKCE: the code is only good with the secret this page made.
      verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
      query.code_challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
      query.code_challenge_method = 'S256';
    }
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    popup.location.href = url.href;
    const answer = await new Promise((resolve, reject) => {
      const heard = (event) => {
        if (event.source !== popup || !event.data?.blueprintSignIn) return;
        removeEventListener('message', heard);
        clearInterval(watching);
        resolve(new URLSearchParams(event.data.blueprintSignIn.hash || event.data.blueprintSignIn.search));
      };
      addEventListener('message', heard);
      const watching = setInterval(() => {
        if (!popup.closed) return;
        clearInterval(watching);
        removeEventListener('message', heard);
        reject(new Error('the sign-in window was closed'));
      }, 500);
    });
    if (answer.get('error')) throw new Error(answer.get('error_description') ?? answer.get('error'));
    if (answer.get('state') !== state) throw new Error('the sign-in came back for another request');
    let accessToken = answer.get('access_token');
    let expiresIn = Number(answer.get('expires_in')) || null;
    if (tokenUrl) {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: answer.get('code') ?? '', redirect_uri: returnTo, client_id: settings.client_id, code_verifier: verifier }),
      });
      const tokens = await response.json();
      if (!response.ok) throw new Error(tokens.error_description ?? tokens.error ?? `the provider answered ${response.status}`);
      accessToken = tokens.access_token;
      expiresIn = Number(tokens.expires_in) || null;
    }
    if (!accessToken) throw new Error('the provider gave no token');
    const token = { accessToken, name: nameOf(accessToken), expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null };
    keep(where, token);
    return token;
  } finally {
    if (!popup.closed) popup.close();
  }
}

/**
 * The scheme the environment's contracts say how to sign in with, or null:
 * the page's header offers Sign in only when there's one.
 *
 * @param {{ contracts: object }} site - As inEnvironment gave it
 */
export function canSignIn(site) {
  return anyScheme(extract(site.contracts, 'docs'));
}

/**
 * Sign in from the page's header, for the environment the page is in: with
 * the first scheme its contracts say how to sign in with, as Swagger UI's
 * Authorize does. Opened from a click.
 *
 * @param {{ contracts: object, scope: string }} site - As inEnvironment gave it
 */
export function signInFromHeader(site) {
  const scheme = canSignIn(site);
  if (!scheme) return Promise.reject(new Error('the contracts say no way to sign in'));
  return signIn(scheme, { scope: site.scope });
}
