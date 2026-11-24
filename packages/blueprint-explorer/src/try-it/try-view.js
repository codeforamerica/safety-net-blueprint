/**
 * An operation card's Try it view (send-panel.js has its styles): with Try
 * it on, the card shows what to send and what came back in one column, and
 * its docs fold under its description, opened on asking.
 *
 * @param {HTMLElement} card - The card, with `.op-docs` and, in it, `.op-desc`
 */
export function tryView(card) {
  card.classList.add('trying');
  const fold = Object.assign(document.createElement('button'), { type: 'button', className: 'try-docs', textContent: '▸ Docs' });
  fold.setAttribute('aria-expanded', 'false');
  fold.onclick = () => {
    const open = card.classList.toggle('docs-open');
    fold.textContent = open ? '▾ Docs' : '▸ Docs';
    fold.setAttribute('aria-expanded', String(open));
  };
  const description = card.querySelector('.op-docs > .op-desc');
  if (description) description.after(fold); else card.querySelector('.op-docs')?.prepend(fold);
}
