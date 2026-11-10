/**
 * A live sequence diagram, for a page: participants side by side, and the
 * messages between them drawn as they happen, each opening to what passed
 * and what it uses — an operation, an event, a message — linked to where
 * that's defined. In the browser, with no dependencies.
 *
 * The vocabulary is UML's, as Mermaid and PlantUML write sequence diagrams:
 * participants, messages — a call that waits for its answer, a reply, or an
 * async message that doesn't wait — and notes over a participant. Each row
 * can carry a caption beside it: what a person sees at that moment.
 *
 *   import { createSequence } from '@codeforamerica/blueprint-explorer/sequence';
 *
 *   const sequence = createSequence(element, {
 *     participants: [{ id: 'browser', name: 'Browser' }, { id: 'server', name: 'Server' }],
 *     captionTitle: 'What the worker sees',
 *   });
 *   const step = sequence.message({ from: 'browser', to: 'server', kind: 'call', text: 'start a transcript' });
 *   step.update({
 *     details: { Request: 'POST /transcripts …', Response: '201 …' },
 *     refs: [{ name: 'createTranscript', kind: 'operation', file: 'transcripts-openapi.yaml', href: '…' }],
 *   });
 *
 * It only draws. Running things a step at a time is the page's to do: what
 * runs can only be paused where it runs.
 */

const STYLE_ID = 'blueprint-sequence-style';

const STYLE = `
.bps { --bps-ink: #1a1a1a; --bps-muted: #666; --bps-line: #dcdcdc; --bps-accent: #5650BE; --bps-warn: #AF121D;
  --bps-code-bg: #F3F3F3; --bps-open: #FFF3E0;
  font: 14px/1.45 'Helvetica Neue', Helvetica, Arial, sans-serif; color: var(--bps-ink); }
@media (prefers-color-scheme: dark) {
  .bps { --bps-ink: #ecebe6; --bps-muted: #9a9993; --bps-line: #3a3936; --bps-accent: #C2C0E8; --bps-warn: #F9C8CB;
    --bps-code-bg: #2a2a27; --bps-open: #4a4120; }
}
.bps-row, .bps-head { display: grid; grid-template-columns: var(--bps-caption, 2fr) 3fr; gap: 0 16px; }
.bps.bps-no-caption .bps-row, .bps.bps-no-caption .bps-head { grid-template-columns: 1fr; }
.bps-head { font-weight: 600; font-size: 0.85rem; padding-bottom: 6px; border-bottom: 1px solid var(--bps-line);
  position: sticky; top: 0; background: inherit; z-index: 1; }
.bps-participants { display: grid; text-align: center; }
.bps-row { border-bottom: 1px solid var(--bps-line); }
.bps-caption { padding: 6px 0; font-size: 0.92rem; overflow-wrap: anywhere; }
.bps-caption b { color: var(--bps-muted); font-weight: 600; margin-right: 4px; }
.bps-caption.bps-progress { color: var(--bps-muted); font-style: italic; }
.bps-caption.bps-aside { color: var(--bps-muted); }
.bps-caption.bps-warn { color: var(--bps-warn); }
.bps-lanes { position: relative; padding: 4px 0; }
.bps-lifeline { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--bps-line); }
.bps-step { position: relative; height: 30px; }
.bps-message, .bps-note { position: absolute; top: 0; height: 100%; padding: 0; border: 0; background: none;
  color: var(--bps-ink); font: inherit; font-size: 0.78rem; cursor: default; }
.bps-message::before { content: ""; position: absolute; left: 0; right: 0; bottom: 6px; border-top: 1.5px solid currentColor; }
.bps-message.bps-reply::before { border-top-style: dashed; }
.bps-message::after { content: ""; position: absolute; right: -1px; bottom: 2px; border: 5px solid transparent;
  border-left: 8px solid currentColor; border-right: 0; }
.bps-message.bps-leftward::after { right: auto; left: -1px; border-left: 0; border-right: 8px solid currentColor; }
/* An async message or a reply has an open head, as UML draws them. */
.bps-message.bps-async::after, .bps-message.bps-reply::after { width: 7px; height: 7px; bottom: 2.5px; right: 0;
  border: 0; border-top: 1.5px solid currentColor; border-right: 1.5px solid currentColor; transform: rotate(45deg); }
.bps-message.bps-async.bps-leftward::after, .bps-message.bps-reply.bps-leftward::after { right: auto; left: 0;
  border-right: 0; border-left: 1.5px solid currentColor; transform: rotate(-45deg); }
.bps-label { position: absolute; left: 0; right: 0; top: 1px; text-align: center; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; }
.bps-note { transform: translateX(-50%); white-space: nowrap; padding: 2px 6px; }
.bps-warn, .bps-warn .bps-label { color: var(--bps-warn); }
.bps-has-detail { cursor: pointer; }
.bps-has-detail .bps-label { text-decoration: underline dotted; text-underline-offset: 3px; }
.bps-open .bps-label { background: var(--bps-open); border-radius: 3px; }
.bps-detail { grid-column: 1 / -1; padding: 0 0 10px; }
.bps-detail h4 { margin: 8px 0 2px; font-size: 0.72rem; color: var(--bps-muted); font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.03em; }
.bps-detail pre { margin: 0; padding: 8px; background: var(--bps-code-bg); border-radius: 6px; font-size: 0.78rem;
  white-space: pre-wrap; overflow-wrap: anywhere; max-height: 300px; overflow: auto; }
.bps-detail p { margin: 0; font-size: 0.88rem; }
.bps-refs { margin: 0; padding: 0; list-style: none; font-size: 0.85rem; }
.bps-refs li { margin: 2px 0; }
.bps-refs code { font-size: 0.82rem; }
.bps-refs .bps-kind { color: var(--bps-muted); }
.bps-refs a { color: var(--bps-accent); }
`;

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pretty = (value) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));

function addStyle(document) {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE;
  document.head.append(style);
}

/**
 * A caption: plain text, or `{ who, text, style }` — who said it, set apart,
 * and a style: `progress` for something still changing, `aside`, or `warn`.
 */
function captionHtml(caption) {
  if (caption == null) return { html: '', style: '' };
  if (typeof caption === 'string') return { html: escape(caption), style: '' };
  return { html: `${caption.who ? `<b>${escape(caption.who)}</b>` : ''}${escape(caption.text ?? '')}`, style: caption.style ?? '' };
}

/**
 * @param {HTMLElement} element - where to draw it
 * @param {object} options
 * @param {Array<{ id: string, name: string }>} options.participants - left to right
 * @param {string} [options.captionTitle] - heads the caption column; without it, there is none
 */
export function createSequence(element, { participants, captionTitle }) {
  const document = element.ownerDocument;
  addStyle(document);
  const ids = participants.map((p) => p.id);
  // Each participant's lifeline is at the middle of its share of the width.
  const at = (id) => {
    const i = ids.indexOf(id);
    if (i === -1) throw new Error(`No participant "${id}"`);
    return (2 * i + 1) / (2 * ids.length);
  };

  element.classList.add('bps');
  element.classList.toggle('bps-no-caption', !captionTitle);
  element.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'bps-head';
  head.innerHTML = `${captionTitle ? `<div>${escape(captionTitle)}</div>` : ''}<div class="bps-participants" style="grid-template-columns: repeat(${ids.length}, 1fr)">${
    participants.map((p) => `<span class="bps-participant" data-id="${escape(p.id)}">${escape(p.name)}</span>`).join('')}</div>`;
  const body = document.createElement('div');
  element.append(head, body);

  const rename = (id, name) => {
    const span = head.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (span) span.textContent = name;
  };

  function row({ caption } = {}) {
    const el = document.createElement('div');
    el.className = 'bps-row';
    el.innerHTML = `${captionTitle ? '<div class="bps-caption"></div>' : ''}<div class="bps-lanes">${
      ids.map((id) => `<span class="bps-lifeline" style="left:${at(id) * 100}%"></span>`).join('')}</div><div class="bps-detail" hidden></div>`;
    // Follow the newest row, unless someone scrolled up to read.
    const scroller = element.closest('[data-bps-scroll]') ?? element;
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
    body.append(el);
    if (atBottom) scroller.scrollTop = scroller.scrollHeight;
    const lanes = el.querySelector('.bps-lanes');
    const detail = el.querySelector('.bps-detail');
    let shown = null;

    const handle = {
      caption(next) {
        const cell = el.querySelector('.bps-caption');
        if (!cell) return handle;
        const { html, style } = captionHtml(next);
        cell.innerHTML = html;
        cell.className = `bps-caption${style ? ` bps-${style}` : ''}`;
        return handle;
      },
      message(options) { return step(options); },
      note({ over, ...options }) { return step({ ...options, from: over, to: null }); },
    };

    /** One message or note on this row. */
    function step({ from, to, kind = 'call', text = '', warn = false, details, refs, explain }) {
      const wrap = document.createElement('div');
      wrap.className = 'bps-step';
      const a = at(from);
      const b = to ? at(to) : a;
      wrap.innerHTML = to
        ? `<button class="bps-message bps-${kind}${b < a ? ' bps-leftward' : ''}${warn ? ' bps-warn' : ''}" style="left:${Math.min(a, b) * 100}%;width:${Math.abs(a - b) * 100}%"><span class="bps-label"></span></button>`
        : `<button class="bps-note${warn ? ' bps-warn' : ''}" style="left:${a * 100}%"><span class="bps-label"></span></button>`;
      lanes.append(wrap);
      const button = wrap.querySelector('button');
      const state = { details: new Map(), refs: [], explain: null };

      const render = () => {
        const sections = [];
        if (state.explain) sections.push(`<p>${escape(state.explain)}</p>`);
        for (const [title, value] of state.details) sections.push(`<h4>${escape(title)}</h4><pre>${escape(pretty(value))}</pre>`);
        if (state.refs.length) {
          sections.push(`<h4>Defined in</h4><ul class="bps-refs">${state.refs.map((ref) => `<li><code>${escape(ref.name)}</code>${
            ref.kind ? ` <span class="bps-kind">${escape(ref.kind)}</span>` : ''} — ${
            ref.href ? `<a href="${escape(ref.href)}" target="_blank" rel="noopener">${escape(ref.file ?? ref.href)}</a>` : escape(ref.file ?? '')}</li>`).join('')}</ul>`);
        }
        detail.innerHTML = sections.join('');
      };
      const open = () => {
        for (const other of el.querySelectorAll('.bps-open')) other.classList.remove('bps-open');
        button.classList.add('bps-open');
        detail.hidden = false;
        render();
      };
      button.addEventListener('click', () => {
        if (shown === message) { shown = null; detail.hidden = true; button.classList.remove('bps-open'); } else { shown = message; open(); }
      });

      const message = {
        /**
         * Change what it says, or add details — a step that grows, like a
         * sentence being heard. `refs` are what it uses, each
         * `{ name, kind?, file?, href? }`: shown as the name, linked to
         * where it's defined.
         */
        update({ text: nextText, details: more, refs: uses, explain: why } = {}) {
          if (nextText !== undefined) button.querySelector('.bps-label').textContent = nextText;
          for (const [title, value] of Object.entries(more ?? {})) state.details.set(title, value);
          if (uses) state.refs = uses;
          if (why !== undefined) state.explain = why;
          button.classList.toggle('bps-has-detail', Boolean(state.details.size || state.refs.length || state.explain));
          if (shown === message) render();
          return message;
        },
      };
      return message.update({ text, details, refs, explain });
    }

    return handle.caption(caption);
  }

  return {
    /** A row with a caption, for steps that belong together. */
    row,
    /** A message on a row of its own. */
    message: ({ caption, ...options }) => row({ caption }).message(options),
    /** A note over one participant, on a row of its own. */
    note: ({ caption, ...options }) => row({ caption }).note(options),
    /** Rename a participant. */
    participant: (id, { name } = {}) => rename(id, name),
    clear() { body.innerHTML = ''; },
  };
}
