import { randomUUID } from 'node:crypto';
import type { TestInfo } from '@playwright/test';
import type {
  AcceptSuggestionRequest, AcceptSuggestionResponse, ApiError, EvidenceAcknowledgement,
  OwnerDecisionRequest, OwnerDecisionResponse, RejectSuggestionRequest, RejectSuggestionResponse,
  ReviewAcknowledgement, ReviewEvidenceRequest, RuleSuggestionQueueResponse, SubmitEvidenceRequest
} from '../../src/shared/contracts';
import { waitForEvaluation } from '../support/api';
import { test, expect } from '../support/fixtures';
import type { LocalD1Controls } from '../support/types';

function requireLocalD1(controls: LocalD1Controls | undefined, info: TestInfo): asserts controls is LocalD1Controls {
  if (!controls) {
    info.annotations.push({ type: 'blocked', description: 'Disposable local D1 controls are required for consistency checks.' });
    test.skip(true, 'Disposable local D1 controls are required.');
  }
}

async function record(info: TestInfo, data: Record<string, string | number | null>) {
  await info.attach('consistency-check', { contentType: 'application/json', body: JSON.stringify(data) });
}

for (const variant of ['change-before-review', 'change-during-evaluation'] as const) {
  test.describe(`B-N05 ${variant}`, () => {
    test.use({ scenario: 'B' });
    test('changed proof cannot authorize completion from an old snapshot', {
      annotation: [{ type: 'matrix-id', description: 'B-N05' }, { type: 'matrix-variant', description: variant }]
    }, async ({ runtime: { member, owner, localD1 } }, info) => {
      requireLocalD1(localD1, info);
      const intake = await member.intake('demo-b', 'Synthetic evidence consistency check');
      const waiting = await waitForEvaluation(member, intake.caseId, intake.evaluationOperationId);
      expect(waiting.status).toBe('WAITING_EVIDENCE');
      const proof = await member.call<EvidenceAcknowledgement>('POST', `/api/cases/${waiting.id}/evidence`, 201, {
        expectedCaseVersion: waiting.caseVersion, orderId: waiting.order.id,
        orderVersion: waiting.order.orderVersion, tracking: waiting.order.tracking,
        source: 'SELLER', type: 'PACKING', reference: 'qa-proof-consistency',
        observedAt: Math.floor(Date.now() / 1000) - 1
      } satisfies SubmitEvidenceRequest);
      const submitted = await member.detail(waiting.id);
      const path = `/api/cases/${waiting.id}/evidence/${proof.evidenceId}/review`;
      const review: ReviewEvidenceRequest = {
        expectedCaseVersion: submitted.caseVersion, expectedEvidenceVersion: proof.evidenceVersion,
        reviewStatus: 'VERIFIED', reason: 'Synthetic owner proof review'
      };
      const initial = await localD1.inspect(waiting.id);
      expect(initial.receiptCount).toBe(0);
      let operationId: string | null = null;
      let failedOperationStatus: string | null = null;
      let errorCode: string;
      let replayStatus: number | null = null;

      if (variant === 'change-before-review') {
        await localD1.invalidateProof(waiting.id, proof.evidenceId);
        const changed = await member.detail(waiting.id);
        const changedProof = changed.evidence.find(e => e.id === proof.evidenceId)!;
        expect(changedProof.tracking).not.toBe(changed.order.tracking);
        const stale = await owner.call<ApiError>('POST', path, 409, review);
        expect(stale.error.code).toBe('STALE_VERSION');
        expect(await member.detail(waiting.id)).toEqual(changed);
        const response = await owner.call<ApiError>('POST', path, 409, {
          ...review, expectedCaseVersion: changed.caseVersion, expectedEvidenceVersion: changedProof.evidenceVersion
        });
        errorCode = response.error.code;
        expect(errorCode).toBe('PROOF_CONTEXT_MISMATCH');
        expect(response.error.requestId).toMatch(/\S/);
        expect(await member.detail(waiting.id)).toEqual(changed);
        expect(await localD1.inspect(waiting.id)).toEqual(initial);
      } else {
        const key = randomUUID();
        const hold = localD1.holdNextEvaluation();
        const pending = owner.call<ReviewAcknowledgement>('POST', path, 200, review, key);
        // Attach a rejection handler immediately while waiting for the TEST agent barrier.
        void pending.catch(() => {});
        try {
          await hold.entered;
          const running = await member.detail(waiting.id);
          expect(running.evaluation?.status).toBe('RUNNING');
          expect(running.evaluation?.executionMode).toBeNull();
          expect(running.evidence.find(e => e.id === proof.evidenceId)?.reviewStatus).toBe('VERIFIED');
          expect(running.receipt).toBeNull();
          operationId = running.evaluation!.id;
          await localD1.invalidateProof(waiting.id, proof.evidenceId);
          const changed = await member.detail(waiting.id);
          // Isolate the evidence fence, keeping case, order and catalog versions fixed.
          expect(changed.caseVersion).toBe(running.caseVersion);
          expect(changed.order).toEqual(running.order);
          expect(changed.activeRulesVersion).toBe(running.activeRulesVersion);
          expect(changed.evidenceVersion).toBe(running.evidenceVersion + 1);
        } finally {
          hold.release();
        }
        const ack = await pending;
        expect(ack).toMatchObject({ evidenceId: proof.evidenceId, reviewStatus: 'VERIFIED', evaluationOperationId: operationId });
        const failed = await member.detail(waiting.id);
        expect(failed.evaluation).toMatchObject({ id: operationId, status: 'FAILED', executionMode: 'TEST' });
        failedOperationStatus = failed.evaluation!.status;
        errorCode = failed.evaluation!.error!.code;
        expect(['STALE_VERSION', 'STALE_EVALUATION']).toContain(errorCode);
        expect(failed.receipt).toBeNull();
        expect(failed.decision).toBeNull();
        expect(failed.timeline.filter(e => e.type === 'evaluation.completed')).toHaveLength(
          submitted.timeline.filter(e => e.type === 'evaluation.completed').length
        );
        expect(failed.timeline.filter(e => e.type === 'evaluation.failed')).toHaveLength(1);
        expect((await localD1.inspect(waiting.id)).receiptCount).toBe(0);
        // The durable review acknowledgement is replayed even though its evaluation failed.
        const replay = await owner.request<ReviewAcknowledgement>('POST', path, [200], review, key);
        replayStatus = replay.status;
        expect(replay.body).toEqual(ack);
        expect(await member.detail(waiting.id)).toEqual(failed);
        // A new evaluation must use the changed evidence and wait for current proof.
        const fresh = await member.evaluate(waiting.id);
        const result = await waitForEvaluation(member, waiting.id, fresh.operationId);
        expect(result.status).toBe('WAITING_EVIDENCE');
        expect(result.missingEvidence).toContain('SELLER_PACKING_PROOF');
      }

      const final = await member.detail(waiting.id);
      const finalProof = final.evidence.find(e => e.id === proof.evidenceId)!;
      expect(final.status).toBe('WAITING_EVIDENCE');
      expect(finalProof.tracking).not.toBe(final.order.tracking);
      expect(final.receipt).toBeNull();
      expect(final.decision).toBeNull();
      const stored = await localD1.inspect(waiting.id);
      expect(stored).toMatchObject({ receiptCount: 0, ruleCount: 0, transitionCount: 0, activeRulesVersion: initial.activeRulesVersion });
      expect(stored.evaluationCount).toBe(initial.evaluationCount + (variant === 'change-during-evaluation' ? 2 : 0));
      await record(info, {
        variant, caseId: final.id, proofId: proof.evidenceId, errorCode,
        initialEvidenceVersion: submitted.evidenceVersion, finalEvidenceVersion: final.evidenceVersion,
        initialProofVersion: proof.evidenceVersion, finalProofVersion: finalProof.evidenceVersion,
        reviewStatus: finalProof.reviewStatus, operationId, failedOperationStatus, replayStatus,
        caseStatus: final.status, ...stored
      });
    });
  });
}

for (const variant of ['concurrent', 'accept-first', 'reject-first'] as const) {
  test.describe(`R-N05 ${variant}`, () => {
    test.use({ scenario: 'D' });
    test('accept and reject leave one durable terminal transition', {
      annotation: [{ type: 'matrix-id', description: 'R-N05' }, { type: 'matrix-variant', description: variant }]
    }, async ({ runtime: { member, owner, localD1 } }, info) => {
      requireLocalD1(localD1, info);
      const intake = await member.intake('demo-d', 'Synthetic suggestion consistency check');
      const d = await waitForEvaluation(member, intake.caseId, intake.evaluationOperationId);
      expect(d.status).toBe('NEEDS_OWNER_REVIEW');
      const decision = await owner.call<OwnerDecisionResponse>('POST', `/api/cases/${d.id}/owner-decision`, 200, {
        expectedCaseVersion: d.caseVersion, expectedActiveRulesVersion: d.activeRulesVersion,
        decision: 'RETURN_THEN_REFUND', reason: 'Synthetic learning candidate'
      } satisfies OwnerDecisionRequest);
      const readCatalog = () => owner.call<RuleSuggestionQueueResponse>('GET', '/api/rule-suggestions', 200);
      const before = await readCatalog();
      const suggestion = before.suggestions.find(s => s.id === decision.suggestionId)!;
      expect(suggestion).toMatchObject({ status: 'PENDING', sourceCaseId: d.id, ruleId: null });
      const completed = await member.detail(d.id);
      const initial = await localD1.inspect(d.id);
      expect(initial).toMatchObject({ receiptCount: 1, ruleCount: 0, transitionCount: 0 });
      const path = `/api/rule-suggestions/${suggestion.id}`;
      const acceptBody: AcceptSuggestionRequest = {
        expectedSuggestionVersion: suggestion.suggestionVersion, expectedActiveRulesVersion: before.activeRulesVersion
      };
      const rejectBody: RejectSuggestionRequest = { expectedSuggestionVersion: suggestion.suggestionVersion, reason: 'Synthetic competing rejection' };
      const acceptKey = randomUUID();
      const rejectKey = randomUUID();
      type Reply = AcceptSuggestionResponse | RejectSuggestionResponse | ApiError;
      const accept = () => owner.request<Reply>('POST', `${path}/accept`, [200, 409], acceptBody, acceptKey);
      const reject = () => owner.request<Reply>('POST', `${path}/reject`, [200, 409], rejectBody, rejectKey);
      let accepted: Awaited<ReturnType<typeof accept>>;
      let rejected: Awaited<ReturnType<typeof reject>>;
      if (variant === 'concurrent') [accepted, rejected] = await Promise.all([accept(), reject()]);
      else if (variant === 'accept-first') { accepted = await accept(); rejected = await reject(); }
      else { rejected = await reject(); accepted = await accept(); }
      expect([accepted.status, rejected.status].sort()).toEqual([200, 409]);
      const acceptWon = accepted.status === 200;
      if (variant === 'accept-first') expect(acceptWon).toBe(true);
      if (variant === 'reject-first') expect(acceptWon).toBe(false);
      const winning = acceptWon ? accepted : rejected;
      const losing = acceptWon ? rejected : accepted;
      expect((losing.body as ApiError).error.code).toMatch(/\S/);
      expect((losing.body as ApiError).error.requestId).toMatch(/\S/);
      const catalog = await readCatalog();
      const final = catalog.suggestions.find(s => s.id === suggestion.id)!;
      expect(final.status).toBe(acceptWon ? 'ACCEPTED' : 'REJECTED');
      expect(final.suggestionVersion).toBe(suggestion.suggestionVersion + 1);
      expect(catalog.activeRulesVersion).toBe(before.activeRulesVersion + Number(acceptWon));
      const sourceRules = catalog.activeRules.filter(r => r.sourceCaseId === d.id);
      expect(sourceRules).toHaveLength(Number(acceptWon));
      expect(final.ruleId).toBe(acceptWon ? (winning.body as AcceptSuggestionResponse).ruleId : null);
      if (acceptWon) expect(sourceRules[0]).toMatchObject({ id: final.ruleId, version: catalog.activeRulesVersion });
      const stored = await localD1.inspect(d.id);
      expect(stored).toEqual({ ...initial, transitionCount: 1, ruleCount: Number(acceptWon), activeRulesVersion: catalog.activeRulesVersion });
      const after = await member.detail(d.id);
      expect(after.receipt).toEqual(completed.receipt);
      expect(after.timeline.filter(e => e.type === 'suggestion.accepted' || e.type === 'suggestion.rejected')).toHaveLength(1);

      // Retry both original requests, then try both actions with fresh keys/current versions.
      const replay = acceptWon ? await accept() : await reject();
      expect(replay).toEqual(winning);
      expect((acceptWon ? await reject() : await accept()).status).toBe(409);
      const terminalAccept = await owner.request<ApiError>('POST', `${path}/accept`, [409], {
        expectedSuggestionVersion: final.suggestionVersion, expectedActiveRulesVersion: catalog.activeRulesVersion
      } satisfies AcceptSuggestionRequest);
      const terminalReject = await owner.request<ApiError>('POST', `${path}/reject`, [409], {
        expectedSuggestionVersion: final.suggestionVersion, reason: 'Synthetic terminal retry'
      } satisfies RejectSuggestionRequest);
      expect(terminalAccept.body.error.code).toMatch(/\S/);
      expect(terminalReject.body.error.code).toMatch(/\S/);
      expect(await readCatalog()).toEqual(catalog);
      expect(await localD1.inspect(d.id)).toEqual(stored);
      expect(await member.detail(d.id)).toEqual(after);
      await record(info, {
        variant, caseId: d.id, suggestionId: suggestion.id,
        acceptStatus: accepted.status, rejectStatus: rejected.status, errorCode: (losing.body as ApiError).error.code,
        suggestionStatus: final.status, suggestionVersion: final.suggestionVersion, ruleId: final.ruleId,
        initialRulesVersion: before.activeRulesVersion, replayStatus: replay.status,
        terminalAcceptStatus: terminalAccept.status, terminalRejectStatus: terminalReject.status,
        terminalAcceptCode: terminalAccept.body.error.code, terminalRejectCode: terminalReject.body.error.code,
        ...stored
      });
    });
  });
}
