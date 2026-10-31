import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { TestInfo } from '@playwright/test';
import type {
  ApiError, CaseDetail, CaseQueueResponse, EvaluateAcknowledgement, OwnerDecisionRequest,
  OwnerDecisionResponse, SubmitEvidenceRequest, EvidenceAcknowledgement, AcceptSuggestionResponse,
  RuleSuggestionQueueResponse
} from '../../src/shared/contracts';
import { waitForEvaluation, type ApiClient } from '../support/api';
import { test, expect } from '../support/fixtures';

const covers = (id: string) => ({ annotation: { type: 'matrix-id', description: id } });
const partial = (id: string) => ({ annotation: { type: 'related-matrix-id', description: id } });
const pathFor = (c: CaseDetail) => `/api/cases/${encodeURIComponent(c.id)}`;
const catalog = (api: ApiClient) => api.call<RuleSuggestionQueueResponse>('GET', '/api/rule-suggestions', 200);
const decision = (c: CaseDetail): OwnerDecisionRequest => ({
  expectedCaseVersion: c.caseVersion, expectedActiveRulesVersion: c.activeRulesVersion,
  decision: 'RETURN_THEN_REFUND', reason: 'Synthetic eligible fit decision'
});
function packing(c: CaseDetail, reference: string): SubmitEvidenceRequest {
  return {
    expectedCaseVersion: c.caseVersion, orderId: c.order.id, orderVersion: c.order.orderVersion,
    tracking: c.order.tracking, type: 'PACKING', source: 'SELLER', reference,
    observedAt: Math.floor(Date.now() / 1000) - 1
  };
}
async function intake(api: ApiClient, orderId: string) {
  const ack = await api.intake(orderId, 'Synthetic storage/retry scenario');
  return waitForEvaluation(api, ack.caseId, ack.evaluationOperationId);
}
function record(info: TestInfo, phase: string, c: CaseDetail, counts: Record<string, number | string>) {
  return info.attach('storage-retry-probe', { contentType: 'application/json', body: JSON.stringify({
    phase, caseId: c.id, caseVersion: c.caseVersion, receiptId: c.receipt?.id ?? null,
    auditEventCount: c.timeline.length, evidenceCount: c.evidence.length, ...counts
  }) });
}

test.describe('Local D1 evidence', () => {
  test.use({ scenario: 'D' });

  test('R-N01: committed intake, evaluate, and owner decision replay with no new writes', covers('R-N01'), async ({ runtime: { member, owner, localD1 } }, info) => {
    test.skip(!localD1, 'Requires isolated D1 inspection.');
    const key = randomUUID();
    const ack = await member.intake('demo-d', 'Retry this claim', key);
    const c = await waitForEvaluation(member, ack.caseId, ack.evaluationOperationId);
    expect(c.status).toBe('NEEDS_OWNER_REVIEW');
    const beforeReplay = await localD1!.inspect(c.id);
    expect(beforeReplay.evaluationCount).toBe(1);
    await record(info, 'intake committed', c, { ...beforeReplay });
    expect(await member.intake('demo-d', 'Retry this claim', key)).toEqual(ack);
    expect(await localD1!.inspect(c.id)).toEqual(beforeReplay);
    expect(await member.detail(c.id)).toEqual(c);
    await record(info, 'intake replay', await member.detail(c.id), { ...await localD1!.inspect(c.id) });

    const evalPath = `${pathFor(c)}/evaluate`;
    const evalKey = randomUUID();
    const intent = { expectedCaseVersion: c.caseVersion, expectedActiveRulesVersion: c.activeRulesVersion };
    const evaluated = await member.call<EvaluateAcknowledgement>('POST', evalPath, 202, intent, evalKey);
    const current = await waitForEvaluation(member, c.id, evaluated.operationId);
    const afterEval = await localD1!.inspect(c.id);
    expect(afterEval.evaluationCount).toBe(beforeReplay.evaluationCount + 1);
    await record(info, 'evaluate committed', current, { ...afterEval });
    expect(await member.call('POST', evalPath, 202, intent, evalKey)).toEqual(evaluated);
    expect(await localD1!.inspect(c.id)).toEqual(afterEval);
    expect(await member.detail(c.id)).toEqual(current);
    await record(info, 'evaluate replay', await member.detail(c.id), { ...await localD1!.inspect(c.id) });

    const decidePath = `${pathFor(c)}/owner-decision`;
    const body = decision(current);
    const decideKey = randomUUID();
    const outcome = await owner.call<OwnerDecisionResponse>('POST', decidePath, 200, body, decideKey);
    expect(outcome.receipt.id).toBeTruthy();
    const closed = await member.detail(c.id);
    const before = await localD1!.inspect(c.id);
    expect(before.receiptCount).toBe(1);
    await record(info, 'owner decision committed', closed, { ...before });
    expect(await owner.call('POST', decidePath, 200, body, decideKey)).toEqual(outcome);
    expect(await member.detail(c.id)).toEqual(closed);
    expect(await localD1!.inspect(c.id)).toEqual(before);
    expect((await catalog(owner)).suggestions.filter(s => s.sourceCaseId === c.id)).toHaveLength(1);
    await record(info, 'owner decision replay', await member.detail(c.id), { ...await localD1!.inspect(c.id) });
  });

  test('R-N02: competing versions permit one proof submission and one rule acceptance', covers('R-N02'), async ({ runtime: { member, owner, localD1 } }, info) => {
    test.skip(!localD1, 'Requires isolated D1 inspection.');
    const b = await intake(member, 'demo-b');
    const submit = (ref: string) => member.request<EvidenceAcknowledgement | ApiError>('POST', `${pathFor(b)}/evidence`, [201, 409], packing(b, ref));
    const writes = await Promise.all([submit('attempt-1'), submit('attempt-2')]);
    expect(writes.map(w => w.status).sort()).toEqual([201, 409]);
    const conflict = writes.find(w => w.status === 409)!.body as ApiError;
    expect(conflict.error.code).toBe('STALE_VERSION');
    const current = await member.detail(b.id);
    expect(current.evidence).toHaveLength(1);
    expect(current.caseVersion).toBe(b.caseVersion + 1);
    expect((await localD1!.inspect(b.id)).receiptCount).toBe(0);
    await record(info, 'evidence race conflict', current, { requestStatus:409, errorCode: conflict.error.code, ...await localD1!.inspect(b.id) });

    const d = await intake(member, 'demo-d');
    const out = await owner.call<OwnerDecisionResponse>('POST', `${pathFor(d)}/owner-decision`, 200, decision(d));
    const prior = await catalog(owner);
    const suggestion = prior.suggestions.find(s => s.id === out.suggestionId)!;
    expect(suggestion.status).toBe('PENDING');
    const accept = () => owner.request<AcceptSuggestionResponse | ApiError>('POST', `/api/rule-suggestions/${suggestion.id}/accept`, [200, 409], {
      expectedSuggestionVersion: suggestion.suggestionVersion, expectedActiveRulesVersion: prior.activeRulesVersion
    });
    const competing = await Promise.all([accept(), accept()]);
    expect(competing.map(w => w.status).sort()).toEqual([200, 409]);
    expect((competing.find(w => w.status === 409)!.body as ApiError).error.requestId).toBeTruthy();
    const after = await localD1!.inspect(d.id);
    expect(after).toMatchObject({ receiptCount: 1, ruleCount: 1, transitionCount: 1, activeRulesVersion: prior.activeRulesVersion + 1 });
    await record(info, 'accept race conflict', await owner.detail(d.id), { requestStatus:409, errorCode: (competing.find(w => w.status === 409)!.body as ApiError).error.code, ...after });
  });

  test('R-N04 API/D1 portion: lose the committed response and recover it by same-key retry', partial('R-N04'), async ({ runtime: { member, owner, localD1 } }, info) => {
    test.skip(!localD1, 'Requires isolated post-commit transport fault.');
    const c = await intake(member, 'demo-d');
    const path = `${pathFor(c)}/owner-decision`, body = decision(c), key = randomUUID();
    localD1!.dropNextCommittedResponse();
    await expect(owner.call('POST', path, 200, body, key)).rejects.toThrow('Test request failed');
    const committed = await member.detail(c.id);
    expect(committed.status).toBe('COMPLETED');
    expect(committed.receipt?.id).toBeTruthy();
    const once = await localD1!.inspect(c.id);
    expect(once.receiptCount).toBe(1);
    await record(info, 'response lost after commit', committed, { ...once });
    const replay = await owner.call<OwnerDecisionResponse>('POST', path, 200, body, key);
    expect(replay.receipt.id).toBe(committed.receipt!.id);
    expect(replay.caseVersion).toBe(committed.caseVersion);
    expect(await member.detail(c.id)).toEqual(committed);
    expect(await localD1!.inspect(c.id)).toEqual(once);
    await record(info, 'committed response replay', await member.detail(c.id), { ...await localD1!.inspect(c.id) });
  });

  test('DATA-N02: receipt write fault rolls back decision and audit, then one retry commits', covers('DATA-N02'), async ({ runtime: { member, owner, localD1 } }, info) => {
    test.skip(!localD1, 'Requires atomic write failure injection.');
    const c = await intake(member, 'demo-d');
    const path = `${pathFor(c)}/owner-decision`, body = decision(c), key = randomUUID();
    const prior = await localD1!.inspect(c.id);
    const priorCatalog = await catalog(owner);
    await record(info, 'before injected receipt fault', c, { ...prior });
    const clear = await localD1!.failNextReceiptInsert();
    try {
      const error = await owner.call<ApiError>('POST', path, 500, body, key);
      expect(error.error.requestId).toBeTruthy();
      await record(info, 'rolled back after receipt fault', await member.detail(c.id), { requestStatus: 500, errorCode: error.error.code, ...await localD1!.inspect(c.id) });
    } finally { await clear(); }
    expect(await member.detail(c.id)).toEqual(c);
    expect(await localD1!.inspect(c.id)).toEqual(prior);
    expect(await catalog(owner)).toEqual(priorCatalog);
    const result = await owner.call<OwnerDecisionResponse>('POST', path, 200, body, key);
    const after = await member.detail(c.id);
    expect(after).toMatchObject({ status: 'COMPLETED', receipt: { id: result.receipt.id, mode: 'SIMULATED' } });
    expect(after.timeline.length).toBeGreaterThan(c.timeline.length);
    expect((await localD1!.inspect(c.id)).receiptCount).toBe(1);
    expect(await owner.call('POST', path, 200, body, key)).toEqual(result);
    expect(await member.detail(c.id)).toEqual(after);
    await record(info, 'retry committed and replayed', after, { ...await localD1!.inspect(c.id) });
  });

  test('DATA-N01 API/D1 portion: reopen persisted D1 then reset and reseed the isolated fixture', partial('DATA-N01'), async ({ runtime: { member, owner, localD1 } }, info) => {
    test.skip(!localD1, 'Requires disposable persistent D1.');
    const initial = await catalog(owner);
    const c = await intake(member, 'demo-a');
    expect(c.status).toBe('COMPLETED');
    expect(c.receipt?.id).toBeTruthy();
    const prior = await localD1!.inspect(c.id);
    await record(info, 'before reopening D1', c, { ...prior });
    await localD1!.restartStore();
    expect(await member.detail(c.id)).toEqual(c);
    expect(await localD1!.inspect(c.id)).toEqual(prior);
    await record(info, 'after reopening D1', await member.detail(c.id), { ...await localD1!.inspect(c.id) });
    await localD1!.resetStore();
    const queue = await member.call<CaseQueueResponse>('GET', '/api/cases', 200);
    expect(queue.items).toHaveLength(0);
    expect(await catalog(owner)).toEqual(initial);
    expect((await member.call<ApiError>('GET', pathFor(c), 404)).error.requestId).toBeTruthy();
    const reseeded = await intake(member, 'demo-a');
    expect(reseeded.order).toMatchObject({ id: 'demo-a', tracking: 'trk-a', amountVnd: 189000 });
    expect(reseeded.status).toBe('COMPLETED');
    expect((await localD1!.inspect(reseeded.id)).receiptCount).toBe(1);
    await record(info, 'reseeded intake after empty queue', reseeded, { queueSize: queue.items.length, ...await localD1!.inspect(reseeded.id) });
  });

  test('SEC-N01 API portion: reference strings round-trip and a reachable sentinel records no server fetch', partial('SEC-N01'), async ({ runtime: { member, owner, localD1 } }, info) => {
    test.skip(!localD1, 'The monitored loopback endpoint must be reachable from the local dispatcher.');
    const paths: string[] = [];
    const server = createServer((req, res) => { paths.push(req.url ?? ''); res.writeHead(200).end('synthetic sentinel'); });
    const listening = once(server, 'listening');
    server.listen(0, '127.0.0.1');
    await listening;
    try {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const control = await fetch(`${origin}/control`);
      expect(await control.text()).toBe('synthetic sentinel');
      const refs = [`${origin}/proof-url`, `<img src="${origin}/proof-html">`];
      let c = await intake(member, 'demo-b');
      for (const reference of refs) {
        const ack = await member.call<EvidenceAcknowledgement>('POST', `${pathFor(c)}/evidence`, 201, packing(c, reference));
        c = await owner.detail(c.id);
        expect(c.evidence.find(e => e.id === ack.evidenceId)).toMatchObject({ reference, reviewStatus: 'SUBMITTED' });
        expect(c).toMatchObject({ status: 'WAITING_EVIDENCE', receipt: null });
      }
      const refreshed = await member.detail(c.id);
      expect(refreshed.evidence.map(e => e.reference).sort()).toEqual(refs.sort());
      await info.attach('proof-reference-probe', { contentType: 'application/json', body: JSON.stringify({
        controlRequests: paths.filter(path => path === '/control').length,
        referenceRequests: paths.filter(path => path !== '/control').length,
        submittedReferences: refs.length, observationScope: 'Synthetic local API submission and detail reads'
      }) });
      expect(paths).toEqual(['/control']);
    } finally {
      await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()));
    }
  });

  test('AUTH-N03 local portion: valid sessions cannot grant access when verified ingress trust is off', partial('AUTH-N03'), async ({ runtime: { member, owner, localD1 } }, info) => {
    test.skip(!localD1, 'Requires mutable local ingress trust configuration.');
    const c = await intake(member, 'demo-d');
    const before = await localD1!.inspect(c.id);
    localD1!.setIdentityTrust(false);
    try {
      for (const client of [member, owner]) {
        const denied = await client.call<ApiError>('GET', pathFor(c), 401);
        expect(denied.error).toMatchObject({ code: 'UNAUTHENTICATED', requestId: expect.any(String) });
      }
      const denied = await owner.call<ApiError>('POST', `${pathFor(c)}/owner-decision`, 401, decision(c));
      expect(denied.error.code).toBe('UNAUTHENTICATED');
      await record(info, 'trust-disabled owner write denial', c, { requestStatus:401, errorCode:denied.error.code, ...await localD1!.inspect(c.id) });
    } finally { localD1!.setIdentityTrust(true); }
    expect(await owner.detail(c.id)).toEqual(c);
    expect(await localD1!.inspect(c.id)).toEqual(before);
  });
});
