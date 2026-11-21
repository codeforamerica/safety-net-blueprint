/**
 * An editable combobox (WAI-ARIA Authoring Practices): one box that opens a
 * list of every choice when clicked anywhere, narrows it to what's typed, and
 * fills in the one picked. Typing matches a choice's detail too, unless told
 * not to. Used by Try it's parameters and by the control panel's stub forms.
 */

export const COMBO_STYLE = `
  .combo { position: relative; display: block; }
  .combo-list { position: absolute; z-index: 20; right: 0; min-width: 100%; width: max-content; max-width: 90vw; top: 100%; margin: 2px 0 0; padding: 2px 0; list-style: none; background: #fff; border: 1px solid #c7c4ea; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.12); max-height: 14rem; overflow: auto; }
  .combo-list li { display: flex; gap: 12px; padding: 4px 8px; font: 12px monospace; cursor: pointer; white-space: nowrap; }
  .combo-list li.active, .combo-list li:hover { background: #eeedfb; }
  .combo-list li[aria-selected="true"] .combo-value { font-weight: 700; }
  .combo-detail { color: #777; font-family: system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; }
  .combo-list li.combo-none { color: #888; cursor: default; font-family: system-ui, sans-serif; }
`;

const el = (tag, text = '', className = '') => {
  const node = document.createElement(tag);
  if (text !== '') node.textContent = text;
  if (className) node.className = className;
  return node;
};

let comboCount = 0;

/**
 * Make a text box a combobox. A pick fills the box and sends `input` and
 * `change`, as typing would.
 *
 * @param {HTMLInputElement} box - Already in the page; it's wrapped where it stands
 * @param {{ choices?: { value: string, detail?: string }[], none?: string, matchDetail?: boolean }} [options] -
 *   The choices to start with; what the list says when there are none; and
 *   whether typing matches a choice's detail as well as its value
 * @returns {{ setChoices: (choices: { value: string, detail?: string }[]) => void }}
 */
export function combobox(box, { choices: initial = [], none = 'none', matchDetail = true } = {}) {
  const id = `combo-${++comboCount}`;
  const list = el('ul', '', 'combo-list');
  list.id = id;
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  box.setAttribute('role', 'combobox');
  box.setAttribute('aria-autocomplete', 'list');
  box.setAttribute('aria-expanded', 'false');
  box.setAttribute('aria-controls', id);
  const wrap = el('span', '', 'combo');
  box.replaceWith(wrap);
  wrap.append(box, list);

  let choices = initial;
  let shown = [];
  let active = -1;
  let typed = false; // narrowed only by what's typed, not by a value already in the box
  const render = () => {
    const needle = typed ? box.value.trim().toLowerCase() : '';
    shown = choices.filter((c) => !needle || `${c.value} ${matchDetail ? c.detail ?? '' : ''}`.toLowerCase().includes(needle));
    list.replaceChildren(...(shown.length ? shown.map((choice, i) => {
      const option = el('li', '', i === active ? 'active' : '');
      option.id = `${id}-${i}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(choice.value === box.value));
      option.append(el('span', choice.value, 'combo-value'));
      if (choice.detail) option.append(el('span', choice.detail, 'combo-detail'));
      option.addEventListener('mousedown', (event) => { event.preventDefault(); choose(choice.value); });
      return option;
    }) : [el('li', choices.length ? 'nothing matches' : none, 'combo-none')]));
    if (active >= 0) box.setAttribute('aria-activedescendant', `${id}-${active}`);
    else box.removeAttribute('aria-activedescendant');
    // The highlighted option in view, scrolling the list and nothing else.
    const at = list.querySelector('.active');
    if (at && at.offsetTop < list.scrollTop) list.scrollTop = at.offsetTop;
    else if (at && at.offsetTop + at.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = at.offsetTop + at.offsetHeight - list.clientHeight;
  };
  const open = () => {
    if (!list.hidden) return;
    typed = false;
    active = choices.findIndex((c) => c.value === box.value);
    list.hidden = false;
    box.setAttribute('aria-expanded', 'true');
    render();
  };
  const close = () => {
    list.hidden = true;
    box.setAttribute('aria-expanded', 'false');
    box.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const choose = (value) => {
    box.value = value;
    close();
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('change', { bubbles: true }));
  };
  box.addEventListener('click', open);
  box.addEventListener('focus', open);
  box.addEventListener('blur', close);
  box.addEventListener('input', (event) => {
    if (!event.isTrusted) return; // the box filled in by a pick
    typed = true;
    active = -1;
    if (list.hidden) { list.hidden = false; box.setAttribute('aria-expanded', 'true'); }
    render();
  });
  box.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) { open(); return; }
      if (!shown.length) return;
      active = event.key === 'ArrowDown' ? (active + 1) % shown.length : (active <= 0 ? shown.length : active) - 1;
      render();
    } else if (event.key === 'Enter' && !list.hidden && shown[active]) {
      event.preventDefault();
      choose(shown[active].value);
    } else if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault();
      // Closing the list, not what the list is in, such as the control panel.
      event.stopPropagation();
      close();
    }
  });
  return {
    setChoices: (next) => {
      choices = next;
      if (!list.hidden) render();
    },
  };
}
