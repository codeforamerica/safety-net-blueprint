/**
 * What a call asks for as it goes, on an operation's Try it panel
 * (send-panel.js): the reader signed in.
 */


const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
};

export const ADAPTER_STYLE = `
  .try-adapter { margin: 8px 0; padding: 8px 10px; border: 1px solid #e3e1f5; border-radius: 4px; background: #fbfaff; font-size: 12px; }
  .try-adapter h5 { margin: 0 0 6px; font: 700 12px sans-serif; color: #2B1A78; }
  .try-adapter p { margin: 0 0 6px; color: #444; }
  .try-adapter pre { margin: 0 0 6px; padding: 6px 8px; background: #fff; border: 1px solid #eee; border-radius: 4px; font: 11px monospace; white-space: pre-wrap; max-height: 12rem; overflow: auto; }
  .try-adapter .pick { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
  .try-adapter textarea { font: 12px monospace; width: 100%; box-sizing: border-box; min-height: 7rem; padding: 4px 6px; border: 1px solid #c7c4ea; border-radius: 4px; }
  .try-adapter button { font: 600 12px sans-serif; padding: 4px 14px; border-radius: 4px; border: 1px solid #2B1A78; background: #2B1A78; color: #fff; cursor: pointer; margin-top: 6px; }
  .try-adapter button.quiet { background: #fff; color: #2B1A78; }
  .try-adapter .done { color: #15803d; font-weight: 700; }
  .try-adapter select { font: 12px sans-serif; padding: 2px 4px; }
  .try-adapter .bad { color: #b42318; font-weight: 700; }
`;

/**
 * A call that needs the visitor signed in, waiting while they sign in: Sign
 * in opens the provider's page (sign-in.js), Cancel lets the call go on
 * without, answered 401.
 *
 * @param {{ call: { operationId: string, scheme: object }, signIn: () => Promise<object>, done: (token: object|null) => void }} options
 * @returns {HTMLElement}
 */
export function signInPrompt({ call, signIn, done }) {
  const box = el('div', '', 'try-adapter');
  box.append(el('h5', 'Sign in required'), el('p', `${call.operationId} requires you to sign in.`));
  const result = el('p');
  const go = el('button', 'Sign in');
  const cancel = el('button', 'Cancel');
  cancel.className = 'quiet';
  go.onclick = async () => {
    go.disabled = true;
    try {
      const token = await signIn();
      box.replaceChildren(el('h5', 'Signed in'), el('p', `Signed in as ${token.name}.`, 'done'));
      done(token);
    } catch (error) {
      result.className = 'bad';
      result.textContent = `Not signed in: ${error.message}.`;
      go.disabled = false;
    }
  };
  cancel.onclick = () => {
    box.replaceChildren(el('h5', 'Not signed in'), el('p', `${call.operationId}: 401 Unauthorized.`, 'bad'));
    done(null);
  };
  const buttons = el('div', '', 'pick');
  buttons.append(go, cancel);
  box.append(buttons, result);
  return box;
}
