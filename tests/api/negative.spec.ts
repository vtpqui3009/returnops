import { randomUUID } from 'node:crypto';
import type {
  AcceptSuggestionRequest, ApiError, CaseDetail, EvidenceAcknowledgement, OwnerDecisionRequest,
  OwnerDecisionResponse, RejectSuggestionRequest, ReviewEvidenceRequest,
  RuleSuggestionQueueResponse, SubmitEvidenceRequest
} from '../../src/shared/contracts';
import { ApiClient, waitForEvaluation } from '../support/api';
import { test, expect } from '../support/fixtures';

function expectError(response: ApiError, code: string) {
  expect(response.error?.code).toBe(code);
  expect(response.error?.message).toMatch(/\S/);
  expect(response.error?.requestId).toMatch(/\S/);
}

function state(c: CaseDetail) {
  return {
    caseVersion: c.caseVersion, evidenceVersion: c.evidenceVersion, catalogVersion: c.activeRulesVersion,
    status: c.status, decision: c.decision, receiptId: c.receipt?.id ?? null,
    evidence: c.evidence.map(e => [e.id, e.evidenceVersion, e.reviewStatus])
  };
}

async function intake(member: ApiClient, orderId: string) {
  const ack = await member.intake(orderId, 'Synthetic negative API scenario');
  return waitForEvaluation(member, ack.caseId, ack.evaluationOperationId);
}

test.describe('AUTH-N01', () => {
  test.use({ scenario: 'D' });
  test('MEMBER cannot decide a case or accept/reject its rule suggestion', {
    annotation: { type: 'matrix-id', description: 'AUTH-N01' }
  }, async ({ runtime: { member, owner } }) => {
    const c = await intake(member, 'demo-d');
    expect(c.status).toBe('NEEDS_OWNER_REVIEW');
    const path = `/api/cases/${encodeURIComponent(c.id)}/owner-decision`;
    const decision: OwnerDecisionRequest = {
      expectedCaseVersion: c.caseVersion, expectedActiveRulesVersion: c.activeRulesVersion,
      decision: 'RETURN_THEN_REFUND', reason: 'Synthetic owner decision'
    };
    const readCatalog = () => owner.call<RuleSuggestionQueueResponse>('GET', '/api/rule-suggestions', 200);
    const original = await readCatalog();
    expectError(await member.call<ApiError>('POST', path, 403, decision), 'FORBIDDEN');
    expect(state(await owner.detail(c.id))).toEqual(state(c));
    expect(await readCatalog()).toEqual(original);

    // Obtain a real pending suggestion before exercising both owner-only endpoints.
    const approved = await owner.call<OwnerDecisionResponse>('POST', path, 200, decision);
    const catalog = await readCatalog();
    const suggestion = catalog.suggestions.find(s => s.id === approved.suggestionId);
    expect(suggestion).toMatchObject({ sourceCaseId: c.id, status: 'PENDING', ruleId: null });
    const suggestionPath = `/api/rule-suggestions/${encodeURIComponent(suggestion!.id)}`;
    const before = state(await owner.detail(c.id));
    const accept: AcceptSuggestionRequest = {
      expectedSuggestionVersion: suggestion!.suggestionVersion, expectedActiveRulesVersion: catalog.activeRulesVersion
    };
    const reject: RejectSuggestionRequest = { expectedSuggestionVersion: suggestion!.suggestionVersion, reason: 'Synthetic rejection' };
    for (const [action, body] of [['accept', accept], ['reject', reject]] as const) {
      expectError(await member.call<ApiError>('POST', `${suggestionPath}/${action}`, 403, body), 'FORBIDDEN');
      expect(await readCatalog()).toEqual(catalog);
      expect(state(await owner.detail(c.id))).toEqual(before);
    }
  });
});

test.describe('R-N03', () => {
  test.use({ scenario: 'B' });
  test('conflicting payload cannot mutate; a different actor can reuse the same key', {
    annotation: { type: 'matrix-id', description: 'R-N03' }
  }, async ({ runtime: { member, owner } }) => {
    const c = await intake(member, 'demo-b');
    expect(c.status).toBe('WAITING_EVIDENCE');
    const path = `/api/cases/${encodeURIComponent(c.id)}/evidence`;
    const key = randomUUID();
    const first: SubmitEvidenceRequest = {
      expectedCaseVersion: c.caseVersion, orderId: c.order.id, orderVersion: c.order.orderVersion,
      tracking: c.order.tracking, type: 'PACKING', source: 'SELLER',
      observedAt: Math.floor(Date.now() / 1000) - 1, reference: 'qa-member-reference'
    };
    const memberAck = await member.call<EvidenceAcknowledgement>('POST', path, 201, first, key);
    const submitted = await member.detail(c.id);
    expect(submitted.evidence.some(e => e.id === memberAck.evidenceId)).toBe(true);
    const conflict = await member.call<ApiError>('POST', path, 409, { ...first, reference: 'qa-conflicting-reference' }, key);
    expectError(conflict, 'IDEMPOTENCY_CONFLICT');
    expect(state(await member.detail(c.id))).toEqual(state(submitted));

    const second = { ...first, expectedCaseVersion: submitted.caseVersion, reference: 'qa-owner-reference' };
    const ownerAck = await owner.call<EvidenceAcknowledgement>('POST', path, 201, second, key);
    expect(ownerAck.evidenceId).not.toBe(memberAck.evidenceId);
    const updated = await owner.detail(c.id);
    expect(updated.evidence).toHaveLength(submitted.evidence.length + 1);
    expect(updated.evidence.find(e => e.id === ownerAck.evidenceId)?.reference).toBe(second.reference);
    expect(await member.call<EvidenceAcknowledgement>('POST', path, 201, first, key)).toEqual(memberAck);
    expect(await owner.call<EvidenceAcknowledgement>('POST', path, 201, second, key)).toEqual(ownerAck);
    expect(state(await member.detail(c.id))).toEqual(state(updated));
  });
});

test.describe('Identity probes', () => {
  test.use({ scenario: 'C' });
  test('anonymous reads and MEMBER proof review are denied', {
    // Hosted identity override is a separate environment check. This probe must not report AUTH-N03 PASS.
    annotation: { type: 'related-matrix-id', description: 'AUTH-N03' }
  }, async ({ runtime: { member, owner } }) => {
    const anonymous = new ApiClient(member.origin, {}, process.env.RETURNOPS_TEST_ALLOW_REMOTE === '1');
    expectError(await anonymous.call<ApiError>('GET', '/api/cases', 401), 'UNAUTHENTICATED');
    const c = await intake(member, 'demo-c');
    const proof = c.evidence.find(e => e.source === 'CARRIER' && e.type === 'DELIVERY' && e.reviewStatus === 'SUBMITTED');
    expect(proof).toBeDefined();
    const review: ReviewEvidenceRequest = {
      expectedCaseVersion: c.caseVersion, expectedEvidenceVersion: proof!.evidenceVersion,
      reviewStatus: 'VERIFIED', reason: 'Synthetic unauthorized review attempt'
    };
    const path = `/api/cases/${encodeURIComponent(c.id)}/evidence/${encodeURIComponent(proof!.id)}/review`;
    expectError(await member.call<ApiError>('POST', path, 403, review), 'FORBIDDEN');
    expect(state(await owner.detail(c.id))).toEqual(state(c));
  });
});
