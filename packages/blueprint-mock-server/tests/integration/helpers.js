/**
 * Shared utilities for integration test suites.
 */

import http from 'http';
import { URL } from 'url';
export const BASE_URL = 'http://localhost:1080';
// Event types are short-form (no org prefix). The x-event-type-prefix overlay config
// adds org prefixes at resolve time for state deployments.
export const EVENT_PREFIX = '';

export function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...options.headers }
    };

    if (options.body) {
      const bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      requestOptions.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = http.request(requestOptions, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        statusText: res.statusMessage,
        headers: res.headers,
        json: async () => JSON.parse(data),
        text: async () => data,
      }));
    });
    req.on('error', reject);
    if (options.body) {
      const bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.write(bodyStr);
    }
    req.end();
  });
}

export function caller(id, roles) {
  return { 'X-Caller-Id': id, 'X-Caller-Roles': Array.isArray(roles) ? roles.join(',') : roles };
}

export async function injectEvent(type, data = {}, subject = 'sub-test-1') {
  return fetch(`${BASE_URL}/platform/events`, {
    method: 'POST',
    body: {
      specversion: '1.0',
      type: EVENT_PREFIX + type,
      source: '/test',
      subject,
      data,
    },
  });
}

export async function clearStubs() {
  await fetch(`${BASE_URL}/mock/stubs/events`, { method: 'DELETE' });
}

export async function clearHttpStubs() {
  await fetch(`${BASE_URL}/mock/stubs/http`, { method: 'DELETE' });
}

export async function registerHttpStub(stub) {
  return fetch(`${BASE_URL}/mock/stubs/http`, { method: 'POST', body: stub });
}

export function createTestRunner() {
  let passed = 0;
  let failed = 0;

  async function test(label, fn) {
    try {
      await fn();
      console.log(`  ✓ ${label}`);
      passed++;
    } catch (err) {
      console.log(`  ✗ ${label}`);
      console.log(`      ${err.message}`);
      failed++;
    }
  }

  function section(title) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(title);
    console.log('─'.repeat(60));
  }

  function results() {
    return { passed, failed };
  }

  return { test, section, results };
}

