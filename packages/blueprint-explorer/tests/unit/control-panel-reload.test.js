import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { addControlPanel } from '../../src/lib/control-panel.js';

test('a reload forgets what the tab chose and made: records, stubs, switches, the server and the activity log', () => {
  const dir = mkdtempSync(join(tmpdir(), 'explorer-reload-'));
  try {
    mkdirSync(join(dir, 'mock'));
    writeFileSync(join(dir, 'mock', 'mock.js'), '');
    writeFileSync(join(dir, 'index.html'), '<html><body></body></html>');
    addControlPanel(dir);
    // The first script added, which runs before anything else on the page.
    const script = /<script>([\s\S]*?)<\/script>/.exec(readFileSync(join(dir, 'index.html'), 'utf8'))[1];

    const scope = 'file:///site/mock/';
    const stored = new Map([
      ...['records', 'stubs', 'routing', 'server', 'activity'].map((kind) => [`blueprint-mock-${kind}:${scope}`, 'x']),
      [`blueprint-try-results:${scope}:intake`, 'x'],
      ['blueprint-mock-server:file:///other/mock/', 'x'],
    ]);
    const sessionStorage = {
      removeItem: (key) => stored.delete(key),
    };
    // Object.keys(sessionStorage) lists what's stored, as a browser's does.
    const storage = new Proxy(sessionStorage, { ownKeys: () => [...stored.keys(), 'removeItem'], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
    runInNewContext(script, {
      sessionStorage: storage,
      performance: { getEntriesByType: () => [{ type: 'reload' }] },
      location: { href: 'file:///site/index.html' },
      URL,
    });
    assert.deepEqual([...stored.keys()], ['blueprint-mock-server:file:///other/mock/']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
