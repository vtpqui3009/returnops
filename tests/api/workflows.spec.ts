import type { TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { test, expect } from '../support/fixtures';
import { waitForEvaluation, type ApiClient } from '../support/api';
import { API_CASE_IDS } from '../support/catalog';
import type { Scenario } from '../support/types';
import type {
  AcceptSuggestionRequest, AcceptSuggestionResponse, CaseDetail, EvidenceAcknowledgement, OwnerDecisionRequest, OwnerDecisionResponse,
  ReviewAcknowledgement, ReviewEvidenceRequest, RuleSuggestionQueueResponse, SubmitEvidenceRequest
} from '../../src/shared/contracts';

async function intake(api: ApiClient, id: string) {
  const ack = await api.intake(`demo-${id.toLowerCase()}`, `Synthetic scenario ${id}`);
  expect(ack.caseId).toBeTruthy();
  expect(ack.evaluationOperationId).toBeTruthy();
  const result = await waitForEvaluation(api, ack.caseId, ack.evaluationOperationId);
  if (result.evaluation?.executionMode != null) expect(result.evaluation.executionMode).toBe(process.env.RETURNOPS_TEST_EXECUTION_MODE ?? 'TEST');
  return result;
}

async function submitPacking(api: ApiClient, c: CaseDetail) {
  const body: SubmitEvidenceRequest = {
    expectedCaseVersion: c.caseVersion, orderId: c.order.id, orderVersion: c.order.orderVersion,
    tracking: c.order.tracking, source: 'SELLER', type: 'PACKING',
    reference: 'demo-proof-b-correct', observedAt: Math.floor(Date.now() / 1000)
  };
  const ack = await api.call<EvidenceAcknowledgement>('POST', `/api/cases/${c.id}/evidence`, 201, body);
  return { ack, detail: await api.detail(c.id) };
}

async function verify(owner: ApiClient, c: CaseDetail, source: 'SELLER' | 'CARRIER', type: string) {
  const proof = c.evidence.find(e => e.source === source && e.type === type && e.orderId === c.order.id && e.orderVersion === c.order.orderVersion && e.tracking === c.order.tracking);
  expect(proof, 'Shared seed must provide the required current proof').toBeDefined();
  const ack = await owner.call<ReviewAcknowledgement>('POST', `/api/cases/${c.id}/evidence/${proof!.id}/review`, 200, {
    expectedCaseVersion: c.caseVersion, expectedEvidenceVersion: proof!.evidenceVersion,
    reviewStatus: 'VERIFIED', reason: 'Synthetic owner review for integration testing'
  } satisfies ReviewEvidenceRequest);
  expect(ack.reviewStatus).toBe('VERIFIED');
  expect(ack.evidenceId).toBe(proof!.id);
  return ack;
}

async function decide(owner: ApiClient, id: string, decision: 'DISPUTE' | 'RETURN_THEN_REFUND') {
  const c = await owner.detail(id);
  return owner.call<OwnerDecisionResponse>('POST', `/api/cases/${id}/owner-decision`, 200, {
    expectedCaseVersion: c.caseVersion, expectedActiveRulesVersion: c.activeRulesVersion,
    decision, reason: 'Synthetic owner decision for integration testing'
  } satisfies OwnerDecisionRequest);
}

async function pendingD(member: ApiClient, owner: ApiClient) {
  const d = await intake(member, 'D');
  expect(d.status).toBe('NEEDS_OWNER_REVIEW');
  const outcome = await decide(owner, d.id, 'RETURN_THEN_REFUND');
  expect(outcome.status).toBe('COMPLETED');
  expect(outcome.receipt).toMatchObject({ mode: 'SIMULATED', completionMode: 'MANUAL', agentRunId: null });
  expect(outcome.activeRulesVersion).toBe(d.activeRulesVersion);
  expect(outcome.suggestionId).toBeTruthy();
  const queue = await owner.call<RuleSuggestionQueueResponse>('GET', '/api/rule-suggestions', 200);
  const suggestion = queue.suggestions.find(s => s.id === outcome.suggestionId);
  expect(suggestion).toMatchObject({ status: 'PENDING', sourceCaseId: d.id, ruleId: null });
  return { d, outcome, suggestion: suggestion!, queue };
}

async function evidence(info: TestInfo, c: CaseDetail) {
  await info.attach('terminal-case', { contentType: 'application/json', body: JSON.stringify({
    caseId: c.id, caseVersion: c.caseVersion, evidenceVersion: c.evidenceVersion,
    activeRulesVersion: c.activeRulesVersion, status: c.status, decision: c.decision,
    operation: c.evaluation, receipt: c.receipt && {
      id: c.receipt.id, mode: c.receipt.mode, completionMode: c.receipt.completionMode,
      agentRunId: c.receipt.agentRunId, appliedRuleId: c.receipt.appliedRuleId,
      appliedRuleVersion: c.receipt.appliedRuleVersion, sourceCaseId: c.receipt.sourceCaseId
    }, flags: c.flags
  }) });
}

for (const id of API_CASE_IDS) {
  const scenario: Scenario = id.startsWith('B') ? 'B' : id.startsWith('E') ? 'DE' : id[0] as Scenario;
  test.describe(id, () => {
    test.use({ scenario });
    test('API contract flow', { annotation: { type: 'matrix-id', description: id } }, async ({ runtime: { member, owner } }, info) => {
      if (id === 'A-01') {
        const key = `a-${randomUUID()}`;
        const ack = await member.intake('demo-a', 'Synthetic scenario A', key);
        const c = await waitForEvaluation(member, ack.caseId, ack.evaluationOperationId);
        expect(c.status).toBe('COMPLETED');
        expect(c.decision).toBe('RETURN_THEN_REFUND');
        expect(c.receipt).toMatchObject({ mode: 'SIMULATED', completionMode: 'AUTO' });
        expect(c.receipt?.id).toBeTruthy();
        expect(c.evaluation?.executionMode).toBe(process.env.RETURNOPS_TEST_EXECUTION_MODE ?? 'TEST');
        expect((await member.detail(c.id)).receipt?.id).toBe(c.receipt?.id);
        expect(await member.intake('demo-a', 'Synthetic scenario A', key)).toEqual(ack);
        expect((await member.detail(c.id)).receipt?.id).toBe(c.receipt?.id);
        await evidence(info, c);
      } else if (id.startsWith('B')) {
        const c = await intake(member, 'B');
        expect(c.status).toBe('WAITING_EVIDENCE');
        expect(c.missingEvidence).toContain('SELLER_PACKING_PROOF');
        expect(c.receipt).toBeNull();
        let final = c;
        if (id !== 'B-01') {
          const submitted = await submitPacking(member, c);
          expect(submitted.detail.status).toBe('WAITING_EVIDENCE');
          expect(submitted.detail.receipt).toBeNull();
          expect(submitted.detail.pendingEvaluationOperationId).toBeNull();
          expect(submitted.detail.evidence.find(e => e.id === submitted.ack.evidenceId)?.reviewStatus).toBe('SUBMITTED');
          final = submitted.detail;
          if (id === 'B-03') {
            const ack = await verify(owner, submitted.detail, 'SELLER', 'PACKING');
            expect(ack.evaluationOperationId).toBeTruthy();
            final = await waitForEvaluation(member, c.id, ack.evaluationOperationId!);
            expect(final.status).toBe('COMPLETED');
            expect(final.evaluation?.executionMode).toBe(process.env.RETURNOPS_TEST_EXECUTION_MODE ?? 'TEST');
            expect(final.receipt).toMatchObject({ mode: 'SIMULATED', completionMode: 'AUTO' });
          }
        }
        await evidence(info, final);
      } else if (id === 'C-01') {
        const c = await intake(member, 'C');
        expect(c.status).toBe('NEEDS_OWNER_REVIEW');
        await verify(owner, c, 'CARRIER', 'DELIVERY');
        const outcome = await decide(owner, c.id, 'DISPUTE');
        expect(outcome).toMatchObject({ status: 'COMPLETED', decision: 'DISPUTE', suggestionId: null });
        expect(outcome.receipt).toMatchObject({ mode: 'SIMULATED', completionMode: 'MANUAL', agentRunId: null });
        const final = await member.detail(c.id);
        expect(final.flags).toEqual(expect.arrayContaining(['DELIVERY_CONFLICT', 'REPEATED_COMPLAINTS', 'OVER_HARD_CAP']));
        const suggestions = await owner.call<RuleSuggestionQueueResponse>('GET', '/api/rule-suggestions', 200);
        expect(suggestions.suggestions.some(s => s.sourceCaseId === c.id)).toBe(false);
        await evidence(info, final);
      } else {
        const d = await pendingD(member, owner);
        if (id === 'D-01') { await evidence(info, await member.detail(d.d.id)); return; }
        const e = await intake(member, 'E');
        expect(e.status).toBe('NEEDS_OWNER_REVIEW');
        expect(e.receipt).toBeNull();
        if (id === 'E-01') { await evidence(info, e); return; }
        const accepted = await owner.call<AcceptSuggestionResponse>('POST', `/api/rule-suggestions/${d.suggestion.id}/accept`, 200, {
          expectedSuggestionVersion: d.suggestion.suggestionVersion,
          expectedActiveRulesVersion: d.queue.activeRulesVersion
        } satisfies AcceptSuggestionRequest);
        expect(accepted.activeRulesVersion).toBeGreaterThan(d.queue.activeRulesVersion);
        const acceptedQueue = await owner.call<RuleSuggestionQueueResponse>('GET', '/api/rule-suggestions', 200);
        expect(acceptedQueue.suggestions.find(s => s.id === d.suggestion.id)?.status).toBe('ACCEPTED');
        const rule = acceptedQueue.activeRules.find(r => r.id === accepted.ruleId);
        expect(rule).toBeDefined();
        const before = await member.detail(e.id);
        expect(before.status).toBe('NEEDS_OWNER_REVIEW');
        expect(before.receipt).toBeNull();
        const ack = await member.evaluate(e.id);
        const final = await waitForEvaluation(member, e.id, ack.operationId);
        expect(final.evaluation?.executionMode).toBe(process.env.RETURNOPS_TEST_EXECUTION_MODE ?? 'TEST');
        expect(final.status).toBe('COMPLETED');
        expect(final.decision).toBe('RETURN_THEN_REFUND');
        expect(final.appliedRuleId).toBe(accepted.ruleId);
        expect(final.appliedRuleVersion).toBe(rule!.version);
        expect(final.activeRulesVersion).toBe(accepted.activeRulesVersion);
        expect(final.sourceCaseId).toBe(d.d.id);
        expect(final.receipt).toMatchObject({ mode: 'SIMULATED', completionMode: 'AUTO', sourceCaseId: d.d.id, appliedRuleId: accepted.ruleId, appliedRuleVersion: rule!.version });
        await evidence(info, final);
      }
    });
  });
}
