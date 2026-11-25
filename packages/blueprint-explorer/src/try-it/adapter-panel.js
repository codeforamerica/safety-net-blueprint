/**
 * Adapters on an operation's Try it panel (send-panel.js): picking the record
 * that chooses one, as a session's profile chooses its transcription
 * adapter, with None beside the records; and under None, the developer
 * standing in for the adapter — answering each call it gets, then
 * publishing what it reports (adapters.js); and what an adapter asks for as
 * it goes: the reader signed in, or audio to hear.
 */

import { eventsSentBy, NONE } from './adapters.js';
import { destinationOf } from './routing.js';
import { speakLines, VOICES } from './kokoro.js';

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
  .try-adapter .voices { display: flex; gap: 8px; align-items: center; font-size: 11px; color: #555; margin-top: 4px; }
  .try-adapter .bad { color: #b42318; font-weight: 700; }
  .try-about { margin: 2px 0 8px; font-size: 12px; color: #555; }
  .try-about > summary { cursor: pointer; color: #2B1A78; }
  .try-about > p { margin: 4px 0 0; }
`;

/** The explorer's README, for the longer explanation behind a "What's this?" note. */
export const README = 'https://github.com/codeforamerica/safety-net-blueprint/blob/main/packages/blueprint-explorer/README.md';

/**
 * A short explanation folded away under a question, with a link to more.
 *
 * @param {string} question - The summary, such as "What's None?"
 * @param {string} text
 * @param {string} anchor - The README section to link to
 * @param {string} [className]
 * @returns {HTMLDetailsElement}
 */
export function aboutNote(question, text, anchor, className = 'try-about') {
  const about = el('details', '', className);
  const more = Object.assign(el('a', 'More'), { href: `${README}#${anchor}`, target: '_blank', rel: 'noopener' });
  const p = el('p', `${text} `);
  p.append(more);
  about.append(el('summary', question), p);
  return about;
}

/** An adapter's API document. */
const adapterDoc = (docs, api) => docs.find((doc) => doc.type === 'openapi' && doc.api === api);

/**
 * A row picking the record a request names, when the record chooses an
 * adapter: each record the site routes to an adapter, saying which, and
 * None, where the developer plays the adapter, last.
 *
 * @param {{ field: string, records: object[], answers: (record: object) => { entry: object|null }[],
 *   value: string, onPick: (value: string) => void }} options -
 *   The request field; the records an adapter answers; what answers each; the
 *   record picked, or NONE; and what to do on a pick
 * @returns {HTMLElement}
 */
export function recordPicker({ field, records, answers, value, onPick }) {
  const select = el('select');
  for (const record of records) {
    const answering = answers(record).filter(({ entry }) => entry).map(({ entry }) => destinationOf(entry));
    select.append(Object.assign(el('option', `${record.name ?? record.id} — ${answering.join(', ')}`), { value: record.id }));
  }
  select.append(Object.assign(el('option', 'None — you play the adapter'), { value: NONE }));
  select.value = value;
  select.onchange = () => onPick(select.value);
  const label = el('label', field);
  label.title = 'The record this names chooses the adapter, through the site\'s routing. Under None, you answer the adapter\'s calls and publish what it reports.';
  const row = el('div', '', 'row');
  row.append(label, select);
  const wrapper = el('div');
  wrapper.append(row, aboutNote('What\'s None?', 'Pick None to act as the adapter yourself, instead of the code the environment routes to. '
    + 'Each call the session makes to the adapter waits here for your response, and then you can publish the events the adapter would send.',
  'transcription-session-adapters'));
  return wrapper;
}

/** An example body for one of an operation's responses, from the contract. */
function responseExample(doc, docs, response, follow) {
  const content = follow(doc, response, docs)?.content?.['application/json'];
  if (!content) return undefined;
  if (content.example !== undefined) return content.example;
  const named = Object.values(content.examples ?? {})[0];
  if (named) return follow(doc, named, docs)?.value;
  return follow(doc, content.schema, docs)?.example ?? {};
}

/**
 * A call an adapter got, waiting for the developer's answer: the request,
 * and an answer to edit, from the contract's responses.
 *
 * @param {{ call: object, docs: object[], follow: Function, answer: (status: number, body: unknown) => void }} options
 * @returns {HTMLElement}
 */
export function answerForm({ call, docs, follow, answer }) {
  const box = el('div', '', 'try-adapter');
  const title = call.doc.content?.info?.title ?? call.doc.api;
  const path = call.path.replace(/\{([^}]+)\}/g, (_, name) => call.params[name] ?? `{${name}}`);
  box.append(
    el('h5', `${title}: ${call.operation.operationId}`),
    el('p', 'Waiting for your response, as the adapter.'),
    el('pre', `${call.method} ${path}${call.body === undefined ? '' : `\n${JSON.stringify(call.body, null, 2)}`}`),
  );
  const responses = Object.entries(call.operation.responses ?? {});
  const status = el('select');
  status.append(...responses.map(([code, response]) => Object.assign(el('option', `${code} ${follow(call.doc, response, docs)?.description ?? ''}`.trim()), { value: code })));
  status.value = responses.find(([code]) => code.startsWith('2'))?.[0] ?? responses[0]?.[0] ?? '200';
  const body = el('textarea');
  const fill = () => {
    const example = responseExample(call.doc, docs, call.operation.responses?.[status.value], follow);
    body.value = example === undefined ? '' : JSON.stringify(example, null, 2);
  };
  fill();
  status.onchange = fill;
  const pick = el('div', '', 'pick');
  pick.append(el('span', 'Answer'), status);
  const send = el('button', 'Send the answer');
  send.onclick = () => {
    let parsed;
    try { parsed = body.value.trim() ? JSON.parse(body.value) : undefined; } catch (error) {
      box.querySelector('.bad')?.remove();
      box.append(el('p', `Not sent: the answer isn't JSON (${error.message}).`, 'bad'));
      return;
    }
    box.replaceChildren(el('h5', `${title}: ${call.operation.operationId}`), el('p', `Answered ${status.value}.`, 'done'));
    answer(Number(status.value), parsed);
  };
  box.append(pick, body, send);
  return box;
}

/**
 * What an adapter reports, for the developer to publish in its place: each
 * event its AsyncAPI document says it sends, from its example. The event is
 * about the record the operation acted on, so its subject and partition key
 * are that record's id. In its data, another record's id (x-relationship)
 * starts as the one the record names, and a date-time, as now.
 *
 * @param {{ api: string, docs: object[], record: object, publish: (event: object) => Promise<{ ok: boolean, status: number, text: string }> }} options
 * @returns {HTMLElement|null} Null when the adapter sends nothing
 */
export function reportForm({ api, docs, record, publish }) {
  const events = eventsSentBy(api, docs);
  if (!events.length || !record?.id) return null;
  const box = el('div', '', 'try-adapter');
  const title = adapterDoc(docs, api)?.content?.info?.title ?? api;
  box.append(
    el('h5', `What ${title} reports`),
    el('p', 'With None, nothing publishes the adapter\'s events. Publish them yourself, when the adapter would.'),
  );
  const pick = el('select');
  pick.append(...events.map((event, i) => Object.assign(el('option', event.type), { value: String(i), title: event.summary })));
  const summary = el('p');
  const body = el('textarea');
  const fill = () => {
    const { example, summary: said, dateTimes, references } = events[Number(pick.value)];
    // Another record's id is the one the record names; a time is now, as the
    // adapter would send it; anything else, the example's.
    const now = new Date().toISOString();
    const data = Object.fromEntries(Object.entries(example.data ?? {}).map(([name, value]) => [name,
      references.includes(name) && record[name] !== undefined ? record[name] : dateTimes.includes(name) ? now : value]));
    summary.textContent = said;
    body.value = JSON.stringify({ ...example, subject: record.id, partitionkey: record.id, data }, null, 2);
  };
  fill();
  pick.onchange = fill;
  const row = el('div', '', 'pick');
  row.append(el('span', 'Event'), pick);
  const result = el('p');
  const send = el('button', 'Publish');
  send.onclick = async () => {
    let event;
    try { event = JSON.parse(body.value); } catch (error) {
      result.className = 'bad';
      result.textContent = `Not published: the event isn't JSON (${error.message}).`;
      return;
    }
    // Each publish is its own event.
    event.id = crypto.randomUUID();
    event.time = new Date().toISOString();
    send.disabled = true;
    try {
      const answered = await publish(event);
      result.className = answered.ok ? 'done' : 'bad';
      result.textContent = answered.ok ? `Published ${event.type}.` : `Refused with ${answered.status}: ${answered.text}`;
    } finally {
      send.disabled = false;
    }
  };
  box.append(row, summary, body, send, result);
  return box;
}

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

/** What typed lines start as: an interview's opening. */
const TYPED_LINES = `Who lives with you?
My sister and her two kids.
Does anyone in the household work?
I do, at the grocery store. About two hundred dollars a week.`;

const audioKey = (scope) => `blueprint-mock-audio:${scope}`;

/**
 * What the reader chose for an adapter to hear, kept for the browser tab and
 * forgotten on a reload, as signing in is: the choice, and the typed lines and
 * voices. A recording is kept only for the page, since a file can't be stored.
 */
let recordingChosen = null;
const audioChosen = ({ scope }) => {
  try { return JSON.parse(sessionStorage.getItem(audioKey(scope)) ?? 'null'); } catch { return null; }
};
const keepAudio = ({ scope }, chosen) => {
  try {
    if (chosen) sessionStorage.setItem(audioKey(scope), JSON.stringify(chosen));
    else sessionStorage.removeItem(audioKey(scope));
  } catch { /* kept for this page only */ }
};

const on = (device) => (device === 'webgpu' ? 'the GPU' : 'the CPU');

/**
 * The audio a choice gives: the microphone, a recording, or typed lines,
 * spoken in the page first (kokoro.js), the voices taking turns.
 *
 * @returns {Promise<{ given: { microphone: true } | { recording: Blob }, said: string }>}
 */
async function audioFor({ choice, lines, voices }, file, status) {
  if (choice === 'microphone') return { given: { microphone: true }, said: 'the microphone' };
  if (choice === 'recording') {
    if (!file) throw new Error('choose a recording first');
    return { given: { recording: file }, said: file.name };
  }
  const said = lines.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!said.length) throw new Error('type a line to speak first');
  status('Loading the voices (Kokoro). The first time, this downloads the model…');
  const speech = await speakLines(said, voices, ({ line, of, device }) => status(`Speaking line ${line} of ${of} on ${on(device)}…`));
  return { given: { recording: speech.recording }, said: `typed lines, spoken on ${on(speech.device)}` };
}

/**
 * What an adapter that asked for the microphone hears (as-microphone.js),
 * asked the first time one asks in the tab: the microphone itself, a
 * recording, or typed lines. After that the same choice is used without
 * asking, said in a line with Change, which asks again next time.
 *
 * @param {{ where: { scope: string }, done: (given: { microphone: true } | { recording: Blob } | null) => void }} options -
 *   The mock's folder, which the choice is kept under; and what to call
 *   once, with what to give, or null when the reader gives nothing
 * @returns {HTMLElement}
 */
export function audioPrompt({ where, done }) {
  const box = el('div', '', 'try-adapter');
  const status = el('p');
  const say = (text) => { status.className = ''; status.textContent = text; };
  const refuse = (why) => { status.className = 'bad'; status.textContent = why; };
  const finish = ({ given, said }) => {
    const change = el('button', 'Change');
    change.className = 'quiet';
    change.onclick = () => {
      keepAudio(where, null);
      box.replaceChildren(el('h5', 'Audio'), el('p', `Hearing ${said}. You'll be asked again next time.`, 'done'));
    };
    box.replaceChildren(el('h5', 'Audio'), el('p', `Hearing ${said}.`, 'done'), change);
    done(given);
  };

  // Chosen before in this tab: used again, without asking.
  const chosen = audioChosen(where);
  if (chosen && (chosen.choice !== 'recording' || recordingChosen)) {
    box.append(el('h5', 'Audio'), status);
    audioFor(chosen, recordingChosen, say).then(finish, (error) => {
      keepAudio(where, null);
      refuse(`No audio: ${error.message}. You'll be asked next time.`);
      done(null);
    });
    return box;
  }

  box.append(el('h5', 'The adapter wants the microphone'), el('p', 'Choose what it hears. You hear it too, as it streams. You\'re asked once in this tab.'));
  const choice = el('select');
  choice.setAttribute('aria-label', 'Audio');
  choice.append(
    Object.assign(el('option', 'The microphone'), { value: 'microphone' }),
    Object.assign(el('option', 'A recording'), { value: 'recording' }),
    Object.assign(el('option', 'Typed lines, spoken'), { value: 'typed' }),
  );
  choice.value = chosen?.choice ?? 'microphone';
  const file = Object.assign(el('input'), { type: 'file', accept: 'audio/*' });
  const typed = el('div');
  const lines = el('textarea');
  lines.value = chosen?.lines ?? TYPED_LINES;
  lines.setAttribute('aria-label', 'Lines to speak, one a line');
  const voice = (picked, label) => {
    const pick = el('select');
    pick.setAttribute('aria-label', label);
    pick.append(...VOICES.map((v) => Object.assign(el('option', v.name), { value: v.id })));
    pick.value = picked;
    return pick;
  };
  const voices = [voice(chosen?.voices?.[0] ?? 'af_heart', 'First speaker\'s voice'), voice(chosen?.voices?.[1] ?? 'am_michael', 'Second speaker\'s voice')];
  const voiceRow = el('div', '', 'voices');
  voiceRow.append(el('span', 'Voices, taking turns'), ...voices);
  typed.append(lines, voiceRow);
  const show = () => {
    file.hidden = choice.value !== 'recording';
    typed.hidden = choice.value !== 'typed';
  };
  choice.onchange = show;
  show();
  const pickRow = el('div', '', 'pick');
  pickRow.append(choice, file);

  const go = el('button', 'Continue');
  const cancel = el('button', 'Cancel');
  cancel.className = 'quiet';
  go.onclick = async () => {
    const picked = { choice: choice.value, lines: lines.value, voices: voices.map((pick) => pick.value) };
    go.disabled = true;
    cancel.disabled = true;
    try {
      const audio = await audioFor(picked, file.files[0] ?? null, say);
      if (picked.choice === 'recording') recordingChosen = file.files[0];
      keepAudio(where, picked);
      finish(audio);
    } catch (error) {
      refuse(`${error.message[0].toUpperCase()}${error.message.slice(1)}.`);
      go.disabled = false;
      cancel.disabled = false;
    }
  };
  cancel.onclick = () => {
    box.replaceChildren(el('h5', 'No audio'), el('p', 'The adapter didn\'t get the microphone.', 'bad'));
    done(null);
  };
  const buttons = el('div', '', 'pick');
  buttons.append(go, cancel);
  box.append(pickRow, typed, buttons, status);
  return box;
}
