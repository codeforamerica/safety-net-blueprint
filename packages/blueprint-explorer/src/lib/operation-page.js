/**
 * What a page of operations shares, whatever the operations are: the API
 * reference's, or the event catalog's events, each sent through the platform
 * events API. A closed operation is one line; an open one is its docs beside
 * its Try it panel, which the mock running in the page fills.
 */

import { COLORS } from './theme.js';
import { METHOD_STYLE } from './html.js';

/** How an operation looks, closed and open, and the sidebar that lists them. */
export const OPERATION_STYLE = `
  /* An operation's sections: plain headings and lists, one box only, the card. */
  /* Closed, an operation is one line tinted by its method, as Swagger lists
     them: method, path, name. Open, it's the two columns. */
  /* The request (method and path) on its own line, the card's full width;
     the summary, operationId and links on the line below. */
  .op-line { flex: 1 1 100%; min-width: 0; display: flex; align-items: center; gap: 10px; }
  .op-meta { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 10px; padding-left: 20px; }
  /* The path keeps its room and breaks only after a slash; the operationId shrinks first. */
  .op-path { font: 600 13px monospace; color: ${COLORS.text}; min-width: 0; overflow-wrap: anywhere; }
  .op-path > span { white-space: nowrap; }
  .op-name { font-size: 13px; color: #555; }
  .op-id { font-size: 11px; color: #999; flex: 0 1 auto; min-width: 2em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .content-item.op-get    { border-color: ${METHOD_STYLE.get.border} !important; }    .op-get > details > summary    { background: ${METHOD_STYLE.get.bg}66; }
  .content-item.op-post   { border-color: ${METHOD_STYLE.post.border} !important; }   .op-post > details > summary   { background: ${METHOD_STYLE.post.bg}88; }
  .content-item.op-patch, .content-item.op-put { border-color: ${METHOD_STYLE.patch.border} !important; } .op-patch > details > summary, .op-put > details > summary { background: ${METHOD_STYLE.patch.bg}88; }
  .content-item.op-delete { border-color: ${METHOD_STYLE.delete.border} !important; } .op-delete > details > summary { background: ${METHOD_STYLE.delete.bg}88; }
  .content-item > details[open] > summary { border-bottom: 1px solid rgba(0,0,0,0.06); }
  .op-body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0 28px; padding: 2px 18px 16px; font-size: 12.5px; line-height: 1.45; }
  /* The request and the responses beside the docs, where there's room. */
  @media (min-width: 1100px) {
    .op-body:has(.op-side:not(:empty)) { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .op-side { align-self: start; }
  }
  .op-side:empty { display: none; }
  /* Evenly spaced, whatever is showing: hidden items take no room. */
  .op-side { display: flex; flex-direction: column; gap: 12px; padding-top: 12px; }
  .op-side > * { margin-top: 0 !important; flex-shrink: 0; }
  .op-section { margin-top: 12px; }
  .op-h { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; font-weight: 700; color: ${COLORS.text}; padding-bottom: 4px; margin-bottom: 2px; border-bottom: 1px solid #ececec; }
  .param, .field { padding: 5px 0; }
  .field-head { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
  .fname { font: 600 12.5px monospace; color: ${COLORS.text}; }
  .ftype { font: 11.5px monospace; color: #777; }
  .fpreview { font: 11.5px monospace; color: #999; }
  .freq { font-size: 11.5px; color: ${COLORS.richRed}; }
  .fdesc { display: block; color: #555; margin-top: 1px; }
  .fdesc p { margin: 0; }
  .values { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 3px; }
  .values-label { font-size: 11px; color: #888; margin-right: 4px; }
  .value-chip { font: 11.5px monospace; border: 1px solid #ddd; border-radius: 4px; padding: 0 6px; background: #fff; }
  .nested { margin: 0 0 2px 5px; padding-left: 12px; border-left: 2px solid #eeeaf8; }
  .field-summary { list-style: none; cursor: pointer; display: block; padding: 0; background: none !important; }
  .field-summary .chevron { font-size: 9px; color: #aaa; }
  details.more > summary { list-style: none; cursor: pointer; font-size: 12px; color: ${COLORS.midBlue}; background: none !important; }
  details.more[open] > summary { margin-bottom: 4px; }
  .schema-name { font: 600 12px monospace; color: ${COLORS.midBlue}; }
  .returns { color: #888; font-weight: 400; }
  .op-returns { font-size: 13px; color: #555; margin: 0 0 12px; }
  .pill { font: 400 11px sans-serif; color: #666; border: 1px solid #ddd; border-radius: 10px; padding: 0 8px; }
  .pill-req { color: ${COLORS.richRed}; border-color: #f3c2c2; }
  .resp-tabs { display: flex; gap: 2px; margin: 0 0 4px; border-bottom: 1px solid #ececec; }
  .resp-tab { font: 600 12px monospace; padding: 3px 10px; border: 0; border-bottom: 2px solid transparent; background: none; color: #888; cursor: pointer; margin-bottom: -1px; }
  .resp-tab.on { color: ${COLORS.text}; border-bottom-color: ${COLORS.midBlue}; }
  .resp-tab.resp-ok.on { border-bottom-color: ${COLORS.deepGreen}; }
  .resp-tab.resp-bad.on { border-bottom-color: ${COLORS.richRed}; }

  .nav-section-label.nav-resource { font: 600 11px monospace; letter-spacing: 0; text-transform: none; color: rgba(255,255,255,0.6); }
  #sidebar a.nav-op { flex-wrap: nowrap; align-items: flex-start; gap: 6px; padding: 4px 0.75rem 4px 1.1rem; line-height: 1.35; }
  .nav-op-path { flex: 1; min-width: 0; font: 11px monospace; }
  .nav-op-path > span, .nav-resource > span { white-space: nowrap; }
  .nav-method { flex-shrink: 0; width: 3.2em; font: 700 9px monospace; letter-spacing: 0.04em; margin-top: 2px; }
  .nav-method-get { color: #86efac; } .nav-method-post { color: #a5b4fc; }
  .nav-method-put, .nav-method-patch { color: #fcd34d; } .nav-method-delete { color: #fca5a5; }
`;

/** Going to an operation, from the sidebar or a link, opens it; a response tab shows its response. */
export const OPERATION_SCRIPT = `
  document.addEventListener('click', (event) => {
    const tab = event.target.closest('.resp-tab');
    if (!tab) return;
    const section = tab.closest('.responses-section');
    for (const other of section.querySelectorAll('.resp-tab')) other.classList.toggle('on', other === tab);
    for (const panel of section.querySelectorAll('.resp-panel')) panel.hidden = panel.dataset.resp !== tab.dataset.resp;
  });
  const openTarget = () => {
    const target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    const details = target?.matches('.content-item') ? target.querySelector(':scope > details') : null;
    if (details && !details.open) details.open = true;
  };
  addEventListener('hashchange', openTarget);
  openTarget();
  // The sidebar goes to an operation without putting it in the address, so a
  // reload starts from the top; an operation's own # link is the one to share.
  document.addEventListener('click', (event) => {
    const link = event.target.closest('#sidebar a.nav-op');
    if (!link) return;
    const target = document.getElementById(decodeURIComponent(link.getAttribute('href').slice(1)));
    if (!target) return;
    event.preventDefault();
    const details = target.querySelector(':scope > details');
    if (details && !details.open) details.open = true;
    target.scrollIntoView({ block: 'start' });
  });
`;

/**
 * The mock, loaded after the page has rendered so reading never waits on it,
 * and the Try it panels it fills in each operation marked `data-try-op`.
 */
export const MOUNT_SEND_PANELS = `<script src="../mock/mock.js" defer></script>
<script src="../mock/contracts.js" defer></script>
<script type="module">
if (globalThis.BlueprintMock && globalThis.BlueprintContracts) {
  // In the environment the reader picked (try-it/environments.js).
  BlueprintMock.mountSendPanels(BlueprintMock.inEnvironment({
    contracts: BlueprintContracts, version: BlueprintContractsVersion, scope: new URL('../mock/', location.href).href,
  }));
}
</script>`;

