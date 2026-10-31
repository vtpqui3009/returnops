import { test, expect } from '@playwright/test';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { CaseDetail } from '../../src/shared/contracts';
import { ApiClient, validateOrigin, waitForEvaluation } from '../support/api';
import { API_CASE_IDS, E2E_CASE_IDS, MAIN_FLOW_IDS, readCatalog } from '../support/catalog';

async function server(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const instance = createServer(handler);
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  return {
    origin: `http://127.0.0.1:${(instance.address() as AddressInfo).port}`,
    close: () => new Promise<void>((resolve, reject) => instance.close(error => error ? reject(error) : resolve()))
  };
}
function snapshot(id: string, status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED') {
  // Harness-only input for testing the polling helper, not a product fixture or LIVE result.
  return { evaluation: { id, status, error: status === 'FAILED' ? { code: 'TEST_FAILURE' } : null } } as CaseDetail;
}

test('TEST: reject accidental remote/credentialed targets and forged identity headers', () => {
  expect(validateOrigin('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173');
  for (const target of ['https://example.com', 'http://a:b@localhost/', 'http://localhost/api', 'file:///tmp/app', 'http://localhost/?token=x']) expect(() => validateOrigin(target)).toThrow();
  expect(() => new ApiClient('http://localhost', { 'oai-authenticated-user-id': 'forged' })).toThrow();
  expect(() => new ApiClient('http://localhost', { Origin: 'https://example.com' })).toThrow();
});

test('TEST: preserve retry key/body and send same-origin mutation headers', async () => {
  const seen: { origin?: string; key?: string; cookie?: string; body: string }[] = [];
  const s = await server((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      seen.push({ origin: req.headers.origin, key: req.headers['idempotency-key'] as string, cookie: req.headers.cookie, body });
      res.writeHead(201, { 'content-type': 'application/json' }).end('{"caseId":"test-case","evaluationOperationId":"test-op"}');
    });
  });
  try {
    const api = new ApiClient(s.origin, { Cookie: 'test-session=synthetic' });
    await api.intake('demo-a', 'Harness TEST', 'same-key');
    await api.intake('demo-a', 'Harness TEST', 'same-key');
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual(seen[1]);
    expect(seen[0]).toMatchObject({ origin: s.origin, key: 'same-key', cookie: 'test-session=synthetic' });
    await expect(api.call('GET', 'https://example.com/api/cases', 200)).rejects.toThrow('configured test origin');
    await expect(api.call('GET', '/api/../signout-with-chatgpt', 200)).rejects.toThrow('configured test origin');
  } finally { await s.close(); }
});

test('TEST: reject redirects without following them or exposing response bodies', async () => {
  let redirected = false;
  const s = await server((req, res) => {
    if (req.url === '/api/target') redirected = true;
    res.writeHead(302, { Location: '/api/target' }).end('sensitive-test-marker');
  });
  try {
    const api = new ApiClient(s.origin, {});
    await expect(api.call('GET', '/api/cases', 200)).rejects.toThrow('no session headers were logged');
    expect(redirected).toBe(false);
  } finally { await s.close(); }
});

test('TEST: HTTP status and JSON errors are actionable without logging bodies', async () => {
  const s = await server((req, res) => {
    res.writeHead(req.url === '/api/error' ? 403 : 200).end('sensitive-test-marker');
  });
  try {
    const api = new ApiClient(s.origin, {});
    await expect(api.call('GET', '/api/error', 200)).rejects.toThrow('expected HTTP 200, got 403');
    await expect(api.call('GET', '/api/not-json', 200)).rejects.toThrow('response was not JSON');
  } finally { await s.close(); }
});

test('TEST: poll the requested operation rather than an older completed run', async () => {
  const values = [snapshot('old', 'COMPLETED'), snapshot('new', 'PENDING'), snapshot('new', 'RUNNING'), snapshot('new', 'COMPLETED')];
  let calls = 0;
  const result = await waitForEvaluation({ detail: async () => values[calls++] }, 'case', 'new', 1000, 1);
  expect(calls).toBe(4);
  expect(result.evaluation?.id).toBe('new');
});

test('TEST: failed evaluation does not pass because the request was acknowledged', async () => {
  await expect(waitForEvaluation({ detail: async () => snapshot('op', 'FAILED') }, 'case', 'op', 100, 1)).rejects.toThrow('TEST_FAILURE');
});

test('TEST: polling has a finite timeout', async () => {
  await expect(waitForEvaluation({ detail: async () => snapshot('op', 'RUNNING') }, 'case', 'op', 10, 1)).rejects.toThrow('polling budget');
});

test('TEST: matrix IDs and implemented main flows stay linked', () => {
  const catalog = readCatalog();
  expect(new Set(catalog.map(c => c.id)).size).toBe(catalog.length);
  for (const id of [...API_CASE_IDS, ...E2E_CASE_IDS]) expect(catalog.some(c => c.id === id)).toBe(true);
  expect(MAIN_FLOW_IDS).toHaveLength(8);
  expect(new Set(API_CASE_IDS).size).toBe(API_CASE_IDS.length);
  expect(catalog.some(c => c.id === 'SEC-N01')).toBe(true);
});
