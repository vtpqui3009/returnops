import assert from 'node:assert/strict';
import test from 'node:test';
import { actor } from '../src/server/auth';
import { ApiFault, hashPayload, idempotency, parseBody, requireOrigin } from '../src/server/http';
import { z } from 'zod';

const config = { SITES_IDENTITY_VERIFIED: 'true', OWNER_USER_IDS: 'owner', MEMBER_USER_IDS: 'member' };
const request = (headers: Record<string, string> = {}, body?: string) => new Request('https://returnops.local/api/cases', { method: 'POST', headers, body });
const fault = (fn: () => unknown) => assert.throws(fn, (error: unknown) => error instanceof ApiFault);

test('identity ingress and explicit allowlists fail closed', () => {
  fault(() => actor(request(), config));
  fault(() => actor(request({ 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'o@example.test' }), { ...config, SITES_IDENTITY_VERIFIED: 'false' }));
  assert.deepEqual(actor(request({ 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'o@example.test' }), config), { id: 'owner', role: 'OWNER', shopId: 'demo-shop' });
  assert.equal(actor(request({ 'oai-authenticated-user-id': 'member', 'oai-authenticated-user-email': 'm@example.test' }), config).role, 'MEMBER');
  fault(() => actor(request({ 'oai-authenticated-user-id': 'forged', 'oai-authenticated-user-email': 'x@example.test' }), config));
});

test('mutation guard requires same-origin, valid idempotency, canonical payload, and strict JSON schema', async () => {
  const valid = request({ origin: 'https://returnops.local', 'Idempotency-Key': 'intake-1', 'content-type': 'application/json' }, '{"orderId":"demo-a"}');
  requireOrigin(valid); assert.equal(idempotency(valid), 'intake-1');
  assert.equal(hashPayload({ b: 2, a: 1 }), hashPayload({ a: 1, b: 2 }));
  fault(() => requireOrigin(request({ origin: 'https://attacker.test' })));
  fault(() => requireOrigin(request()));
  fault(() => idempotency(request({ 'Idempotency-Key': 'x'.repeat(129) })));
  await assert.rejects(() => parseBody(request({ 'content-type': 'application/json' }, '{"orderId":"demo-a","role":"OWNER"}'), z.object({ orderId: z.string() }).strict()), (error: unknown) => error instanceof ApiFault);
});
