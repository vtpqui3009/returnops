import { randomUUID } from 'node:crypto';
import type { TestInfo } from '@playwright/test';
import type { ApiError, CaseDetail, Evidence, EvidenceAcknowledgement, OwnerDecisionRequest, OwnerDecisionResponse, ReviewAcknowledgement, ReviewEvidenceRequest, RuleSuggestionQueueResponse, SubmitEvidenceRequest } from '../../src/shared/contracts';
import { ApiClient, waitForEvaluation } from '../support/api';
import { test, expect } from '../support/fixtures';
import type { LocalD1Controls } from '../support/types';

const matrix = (id: string) => ({ annotation: { type: 'matrix-id', description: id } });
function controls(value: LocalD1Controls | undefined, info: TestInfo): asserts value is LocalD1Controls {
  if (!value) {
    info.annotations.push({ type: 'blocked', description: 'Requires disposable local D1 controls.' });
    test.skip(true, 'Requires disposable local D1 controls.');
  }
}
async function intake(api: ApiClient, order: string) {
  const ack = await api.intake(`demo-${order}`, `Synthetic ${order} proof and authority checks`);
  return waitForEvaluation(api, ack.caseId, ack.evaluationOperationId);
}
async function evaluate(api: ApiClient, id: string) {
  const ack = await api.evaluate(id);
  return waitForEvaluation(api, id, ack.operationId);
}
const path = (c: CaseDetail) => `/api/cases/${encodeURIComponent(c.id)}`;
const submitBody = (c: CaseDetail): SubmitEvidenceRequest => ({ expectedCaseVersion: c.caseVersion, orderId: c.order.id, orderVersion: c.order.orderVersion, tracking: c.order.tracking, source: 'SELLER', type: 'PACKING', reference: 'qa-pack-reference', observedAt: Math.floor(Date.now() / 1000) - 1 });
async function submit(api: ApiClient, c: CaseDetail, change: Partial<SubmitEvidenceRequest> = {}) {
  const ack = await api.call<EvidenceAcknowledgement>('POST', `${path(c)}/evidence`, 201, { ...submitBody(c), ...change });
  const detail = await api.detail(c.id);
  const proof = detail.evidence.find(e => e.id === ack.evidenceId);
  expect(proof?.reviewStatus).toBe('SUBMITTED');
  return { detail, proof: proof! };
}
const reviewPath = (c: CaseDetail, e: Evidence) => `${path(c)}/evidence/${encodeURIComponent(e.id)}/review`;
const reviewBody = (c: CaseDetail, e: Evidence): ReviewEvidenceRequest => ({ expectedCaseVersion: c.caseVersion, expectedEvidenceVersion: e.evidenceVersion, reviewStatus: 'VERIFIED', reason: 'Synthetic verified inspection' });
const decisionBody = (c: CaseDetail, decision: OwnerDecisionRequest['decision']): OwnerDecisionRequest => ({ expectedCaseVersion: c.caseVersion, expectedActiveRulesVersion: c.activeRulesVersion, decision, reason: 'Synthetic owner decision' });
const catalog = (api: ApiClient) => api.call<RuleSuggestionQueueResponse>('GET', '/api/rule-suggestions', 200);
function errorEnvelope(body: ApiError, code: string) {
  expect(body.error?.code).toBe(code);
  expect(body.error?.requestId).toMatch(/\S/);
  expect(body.error?.message).toMatch(/\S/);
}
function waiting(c: CaseDetail) {
  expect(c.status).toBe('WAITING_EVIDENCE');
  expect(c.missingEvidence).toContain('SELLER_PACKING_PROOF');
  expect(c.pendingEvaluationOperationId).toBeNull();
  expect(c.receipt).toBeNull();
}

test.describe('Packing proof', () => {
  test.use({ scenario: 'B' });

  test('B-N01 rejects wrong order or tracking at verification without side effects', matrix('B-N01'), async ({ runtime: { member, owner, localD1 } }, info) => {
    controls(localD1, info);
    let c = await intake(member, 'b');
    for (const change of [{ orderId: 'demo-a' }, { tracking: 'trk-wrong' }]) {
      const { detail, proof } = await submit(member, c, change);
      const before = await localD1.inspect(c.id);
      const response = await owner.call<ApiError>('POST', reviewPath(c, proof), 409, reviewBody(detail, proof));
      errorEnvelope(response, 'PROOF_CONTEXT_MISMATCH');
      c = await owner.detail(c.id);
      expect(c).toEqual(detail);
      waiting(c);
      expect(await localD1.inspect(c.id)).toEqual(before);
    }
  });

  test('B-N02 submitted matching metadata does not resume B', matrix('B-N02'), async ({ runtime: { member, localD1 } }, info) => {
    controls(localD1, info);
    const c = await intake(member, 'b');
    const before = await localD1.inspect(c.id);
    const { detail, proof } = await submit(member, c);
    expect(proof.verifiedBy).toBeNull();
    expect(proof.verifiedAt).toBeNull();
    waiting(detail);
    expect((await localD1.inspect(c.id)).evaluationCount).toBe(before.evaluationCount);
    waiting(await evaluate(member, c.id));
    expect((await localD1.inspect(c.id)).receiptCount).toBe(0);
  });

  test('B-N03 a once-current verified proof cannot complete after its order changes', matrix('B-N03'), async ({ runtime: { member, owner, localD1 } }, info) => {
    controls(localD1, info);
    const c = await intake(member, 'b');
    const { detail, proof } = await submit(member, c);
    const hold = localD1.holdNextEvaluation();
    const review = owner.call<ReviewAcknowledgement>('POST', reviewPath(c, proof), 200, reviewBody(detail, proof));
    void review.catch(() => {});
    try {
      await hold.entered;
      const running = await owner.detail(c.id);
      expect(running.evidence.find(e => e.id === proof.id)).toMatchObject({ reviewStatus: 'VERIFIED', tracking: running.order.tracking, orderVersion: running.order.orderVersion });
      await localD1.patchOrder(c.order.id, { tracking: 'trk-replaced', orderVersion: c.order.orderVersion + 1 });
    } finally { hold.release(); }
    const ack = await review;
    const stale = await owner.detail(c.id);
    expect(stale.evaluation).toMatchObject({ id: ack.evaluationOperationId, status: 'FAILED' });
    expect(['STALE_VERSION', 'STALE_EVALUATION']).toContain(stale.evaluation?.error?.code);
    expect((await localD1.inspect(c.id)).receiptCount).toBe(0);
    const fresh = await evaluate(member, c.id);
    waiting(fresh);
    expect(fresh.evidence.find(e => e.id === proof.id)).toMatchObject({ tracking: proof.tracking, orderVersion: proof.orderVersion, reviewStatus: 'VERIFIED' });
    expect(fresh.order.tracking).not.toBe(proof.tracking);
  });

  test('B-N04 retrying verification replays one resume and one receipt', matrix('B-N04'), async ({ runtime: { member, owner, localD1 } }, info) => {
    controls(localD1, info);
    const c = await intake(member, 'b');
    const { detail, proof } = await submit(member, c);
    const before = await localD1.inspect(c.id);
    const key = randomUUID();
    const request = () => owner.call<ReviewAcknowledgement>('POST', reviewPath(c, proof), 200, reviewBody(detail, proof), key);
    const ack = await request();
    expect(ack.evaluationOperationId).toBeTruthy();
    const done = await waitForEvaluation(member, c.id, ack.evaluationOperationId!);
    expect(done).toMatchObject({ status: 'COMPLETED', decision: 'RETURN_THEN_REFUND', receipt: { mode: 'SIMULATED' } });
    expect(await request()).toEqual(ack);
    expect(await member.detail(c.id)).toEqual(done);
    expect(await localD1.inspect(c.id)).toMatchObject({ receiptCount: 1, evaluationCount: before.evaluationCount + 1 });
  });

  test('B-N06 verified proof of the wrong source or type does not resume B', matrix('B-N06'), async ({ runtime: { member, owner, localD1 } }, info) => {
    controls(localD1, info);
    let c = await intake(member, 'b');
    for (const change of [{ source: 'BUYER' }, { type: 'DELIVERY' }] as const) {
      const { detail, proof } = await submit(member, c, change);
      const before = await localD1.inspect(c.id);
      const ack = await owner.call<ReviewAcknowledgement>('POST', reviewPath(c, proof), 200, reviewBody(detail, proof));
      expect(ack).toMatchObject({ reviewStatus: 'VERIFIED', evaluationOperationId: null });
      expect((await localD1.inspect(c.id)).evaluationCount).toBe(before.evaluationCount);
      c = await evaluate(member, c.id);
      waiting(c);
      expect((await localD1.inspect(c.id)).receiptCount).toBe(0);
    }
  });
});

test.describe('Dispute', () => {
  test.use({ scenario: 'C' });
  for (const id of ['C-N01', 'C-N02']) {
    test(`${id} verified carrier proof gates a manual non-learning dispute`, matrix(id), async ({ runtime: { member, owner, localD1 } }, info) => {
      controls(localD1, info);
      const c = await intake(member, 'c');
      const proof = c.evidence.find(e => e.source === 'CARRIER' && e.type === 'DELIVERY' && e.reviewStatus === 'SUBMITTED');
      expect(proof).toBeDefined();
      const before = await localD1.inspect(c.id);
      const suggestions = await catalog(owner);
      expect(c.flags.slice().sort()).toEqual(['DELIVERY_CONFLICT', 'OVER_HARD_CAP', 'REPEATED_COMPLAINTS']);
      if (id === 'C-N02') {
        const rejection = await owner.call<ApiError>('POST', `${path(c)}/owner-decision`, 409, decisionBody(c, 'DISPUTE'));
        errorEnvelope(rejection, 'PROOF_REQUIRED');
        expect(await owner.detail(c.id)).toEqual(c);
        expect(await localD1.inspect(c.id)).toEqual(before);
      }
      await owner.call<ReviewAcknowledgement>('POST', reviewPath(c, proof!), 200, reviewBody(c, proof!));
      const fresh = await owner.detail(c.id);
      const outcome = await owner.call<OwnerDecisionResponse>('POST', `${path(c)}/owner-decision`, 200, decisionBody(fresh, 'DISPUTE'));
      expect(outcome).toMatchObject({ decision: 'DISPUTE', status: 'COMPLETED', suggestionId: null, receipt: { completionMode: 'MANUAL', mode: 'SIMULATED' } });
      expect((await owner.detail(c.id)).flags.slice().sort()).toEqual(c.flags.slice().sort());
      expect(await catalog(owner)).toEqual(suggestions);
      expect(await localD1.inspect(c.id)).toMatchObject({ receiptCount: 1, ruleCount: 0, transitionCount: 0, activeRulesVersion: before.activeRulesVersion });
    });
  }
});

test.describe('Pending and rejected rules', () => {
  test.use({ scenario: 'DE' });
  for (const id of ['D-N01', 'E-N01']) {
    test(`${id} D case completion cannot activate learning for another order`, matrix(id), async ({ runtime: { member, owner, localD1 } }, info) => {
      controls(localD1, info);
      const d = await intake(member, 'd');
      const before = await catalog(owner);
      const decision = await owner.call<OwnerDecisionResponse>('POST', `${path(d)}/owner-decision`, 200, decisionBody(d, 'RETURN_THEN_REFUND'));
      const after = await catalog(owner);
      const candidate = after.suggestions.find(s => s.id === decision.suggestionId);
      expect(candidate).toMatchObject({ status: 'PENDING', ruleId: null, sourceCaseId: d.id });
      expect(after.activeRules).toEqual(before.activeRules);
      expect(after.activeRulesVersion).toBe(before.activeRulesVersion);
      const e = await intake(member, 'e');
      const assertWaiting = async () => {
        const result = await evaluate(member, e.id);
        expect(result).toMatchObject({ status: 'NEEDS_OWNER_REVIEW', receipt: null, appliedRuleId: null });
        expect((await localD1.inspect(e.id)).receiptCount).toBe(0);
      };
      await assertWaiting();
      if (id === 'E-N01') {
        await owner.call('POST', `/api/rule-suggestions/${candidate!.id}/reject`, 200, { expectedSuggestionVersion: candidate!.suggestionVersion, reason: 'Synthetic rejection' });
        const rejected = await catalog(owner);
        expect(rejected.suggestions.find(s => s.id === candidate!.id)).toMatchObject({ status: 'REJECTED', ruleId: null });
        expect(rejected.activeRulesVersion).toBe(before.activeRulesVersion);
        expect(rejected.activeRules).toEqual(before.activeRules);
        await assertWaiting();
      }
    });
  }
});

test.describe('Resource and request boundaries', () => {
  test.use({ scenario: 'DE' });
  test('AUTH-N02 resource ownership, proof parentage and strict fields are enforced', matrix('AUTH-N02'), async ({ runtime: { member, owner, localD1 } }, info) => {
    controls(localD1, info);
    const d = await intake(member, 'd');
    const e = await intake(member, 'e');
    const foreignId = await localD1.seedForeignCase();
    const foreignPath = `/api/cases/${encodeURIComponent(foreignId)}`;
    const foreignBefore = await localD1.inspect(foreignId);
    const foreign = await owner.call<ApiError>('GET', foreignPath, 404);
    errorEnvelope(foreign, 'NOT_FOUND');
    expect(JSON.stringify(foreign)).not.toContain('foreign-secret-marker');
    const denied = await owner.call<ApiError>('POST', `${foreignPath}/owner-decision`, 404, decisionBody(d, 'RETURN_THEN_REFUND'));
    errorEnvelope(denied, 'NOT_FOUND');
    expect(JSON.stringify(denied)).not.toContain('foreign-secret-marker');
    expect(await localD1.inspect(foreignId)).toEqual(foreignBefore);

    const proof = e.evidence[0];
    expect(proof).toBeDefined();
    errorEnvelope(await owner.call<ApiError>('POST', reviewPath(d, proof), 404, reviewBody(d, proof)), 'NOT_FOUND');
    for (const field of ['actorId', 'reviewer', 'shopId', 'executionMode', 'completionMode']) {
      errorEnvelope(await owner.call<ApiError>('POST', `${path(d)}/owner-decision`, 400, { ...decisionBody(d, 'RETURN_THEN_REFUND'), [field]: 'synthetic-forged-value' }), 'INVALID_INPUT');
    }
    expect(await owner.detail(d.id)).toEqual(d);
    expect(await owner.detail(e.id)).toEqual(e);
  });

  test('API-N01 mutation validation rejects malformed requests before persistence', matrix('API-N01'), async ({ runtime: { member, headers, localD1 } }, info) => {
    controls(localD1, info);
    const c = await intake(member, 'd');
    const evidencePath = `${path(c)}/evidence`;
    const fixture = submitBody(c);
    const before = await localD1.inspect(c.id);

    // Raw HTTP is needed only for intentionally missing/invalid headers and invalid JSON.
    // The URL always points to the active fixture. The Origin variation is a header value.
    const raw = async (body: string, key: string | undefined, origin: string | undefined, status: number, code: string) => {
      const h = new Headers(headers.MEMBER);
      h.set('Content-Type', 'application/json');
      if (key !== undefined) h.set('Idempotency-Key', key);
      if (origin !== undefined) h.set('Origin', origin);
      const response = await fetch(`${member.origin}${evidencePath}`, { method: 'POST', headers: h, body, redirect: 'error', signal: AbortSignal.timeout(10_000) });
      expect(response.status).toBe(status);
      errorEnvelope(await response.json() as ApiError, code);
    };
    const json = JSON.stringify(fixture);
    for (const invalidKey of [undefined, '', 'k'.repeat(129), 'key\twith-tab']) {
      await raw(json, invalidKey, member.origin, 400, 'INVALID_IDEMPOTENCY_KEY');
    }
    for (const origin of [undefined, 'https://qa-invalid.example.test']) {
      await raw(json, randomUUID(), origin, 403, 'INVALID_ORIGIN');
    }
    await raw('{', randomUUID(), member.origin, 400, 'INVALID_INPUT');
    await raw(JSON.stringify({ ...fixture, expectedCaseVersion: '1' }), randomUUID(), member.origin, 400, 'INVALID_INPUT');
    await raw(JSON.stringify({ ...fixture, unexpected: true }), randomUUID(), member.origin, 400, 'INVALID_INPUT');
    await raw(JSON.stringify({ ...fixture, reference: 'a'.repeat(17_000) }), randomUUID(), member.origin, 400, 'BODY_TOO_LARGE');
    expect(await member.detail(c.id)).toEqual(c);
    expect(await localD1.inspect(c.id)).toEqual(before);

    let latest = c;
    for (const key of ['k', 'k'.repeat(128)]) {
      const accepted = await member.call<EvidenceAcknowledgement>('POST', evidencePath, 201, submitBody(latest), key);
      latest = await member.detail(c.id);
      expect(latest.evidence.find(p => p.id === accepted.evidenceId)?.reviewStatus).toBe('SUBMITTED');
    }
    expect(latest.evidence.length).toBe(c.evidence.length + 2);
    expect((await localD1.inspect(c.id)).receiptCount).toBe(0);
  });
});
