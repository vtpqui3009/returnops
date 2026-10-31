import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { TestInfo } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { ApiClient, waitForEvaluation } from '../support/api';
import type { LocalD1Controls } from '../support/types';
import type {
  AcceptSuggestionResponse, ApiError, CaseDetail, EvaluateAcknowledgement, OwnerDecisionResponse, RuleSuggestionQueueResponse
} from '../../src/shared/contracts';

type Runtime = { member: ApiClient; owner: ApiClient; db: LocalD1Controls };
function matrix(id: string, title: string, check: (r: Runtime, info: TestInfo) => Promise<void>) {
  test.describe(id, () => {
    test.use({ scenario: 'DE' });
    test(title, { annotation: { type: 'matrix-id', description: id } }, async ({ runtime }, info) => {
      test.skip(!runtime.localD1, 'Requires isolated D1 controls and offline agent fault injection.');
      await check({ member: runtime.member, owner: runtime.owner, db: runtime.localD1! }, info);
    });
  });
}
async function intake(api: ApiClient, order = 'demo-e') {
  const ack = await api.intake(order, 'Synthetic policy integration case');
  return waitForEvaluation(api, ack.caseId, ack.evaluationOperationId);
}
async function evaluate(api: ApiClient, id: string) {
  const ack = await api.evaluate(id);
  return waitForEvaluation(api, id, ack.operationId);
}
async function failed(api: ApiClient, id: string, operation: string) {
  await expect.poll(async () => {
    const op = (await api.detail(id)).evaluation;
    return op?.id === operation ? op.status : null;
  }).toBe('FAILED');
  return api.detail(id);
}
function versions(c: CaseDetail) {
  return { expectedCaseVersion: c.caseVersion, expectedActiveRulesVersion: c.activeRulesVersion };
}
function decide<T>(owner: ApiClient, c: CaseDetail, expected: number) {
  return owner.call<T>('POST', `/api/cases/${c.id}/owner-decision`, expected, {
    ...versions(c), decision: 'RETURN_THEN_REFUND', reason: 'Synthetic owner monetary decision'
  });
}
function queue(owner: ApiClient) {
  return owner.call<RuleSuggestionQueueResponse>('GET', '/api/rule-suggestions', 200);
}
async function learnD({ member, owner }: Runtime) {
  const d = await intake(member, 'demo-d');
  const manual = await decide<OwnerDecisionResponse>(owner, d, 200);
  const catalog = await queue(owner);
  const suggestion = catalog.suggestions.find(s => s.id === manual.suggestionId);
  expect(suggestion).toMatchObject({ sourceCaseId: d.id, status: 'PENDING' });
  const rule = await owner.call<AcceptSuggestionResponse>('POST', `/api/rule-suggestions/${suggestion!.id}/accept`, 200, {
    expectedSuggestionVersion: suggestion!.suggestionVersion, expectedActiveRulesVersion: catalog.activeRulesVersion
  });
  return { d, rule };
}
async function record(info: TestInfo, db: LocalD1Controls, c: CaseDetail, variant: string) {
  await info.attach('consistency-check', { contentType: 'application/json', body: JSON.stringify({
    variant, caseId: c.id, operationId: c.evaluation?.id, failedOperationStatus: c.evaluation?.status === 'FAILED' ? 'FAILED' : null,
    caseStatus: c.status, ruleId: c.appliedRuleId, errorCode: c.evaluation?.error?.code, ...await db.inspect(c.id)
  }) });
}
async function assertBlocked(r: Runtime, c: CaseDetail) {
  expect(c.status).toBe('NEEDS_OWNER_REVIEW');
  expect(c.receipt).toBeNull();
  expect(c.appliedRuleId).toBeNull();
  expect((await decide<ApiError>(r.owner, c, 409)).error.code).toBe('POLICY_BLOCKED');
  expect((await r.db.inspect(c.id)).receiptCount).toBe(0);
}

matrix('E-N02', 'A learned rule cannot override the hard cap or a risk flag', async (r, info) => {
  await learnD(r);
  for (const [variant, amountVnd, riskFlags, expected] of [
    ['above cap', 300001, [], 'OVER_HARD_CAP'], ['delivery conflict', 279000, ['DELIVERY_CONFLICT'], 'DELIVERY_CONFLICT']
  ] as const) {
    await r.db.patchOrder('demo-e', { amountVnd, riskFlags: [...riskFlags] });
    const c = await intake(r.member);
    expect(c.flags).toContain(expected);
    await assertBlocked(r, c);
    await record(info, r.db, c, variant);
  }
});

matrix('E-N03', 'AUTO and MANUAL enforce inclusive price and delivery boundaries at commit', async (r, info) => {
  // Run MANUAL before enabling the learned rule so both paths have eligible positive controls.
  for (const lane of ['MANUAL', 'AUTO'] as const) {
    if (lane === 'AUTO') await learnD(r);
    for (const [amountVnd, age, allowed] of [
      [299999, 3600, true], [300000, 3600, true], [300001, 3600, false],
      [279000, 604799, true], [279000, 604800, true], [279000, 604801, false]
    ] as const) {
      // D1 and the dispatcher use epoch seconds. Start at a fresh tick for exact-second assertions.
      await delay(1000 - Date.now() % 1000 + 5);
      const at = Math.floor(Date.now() / 1000);
      await r.db.patchOrder('demo-e', { amountVnd, deliveredAt: at - age });
      let c = await intake(r.member);
      if (!allowed) await assertBlocked(r, c);
      else {
        if (lane === 'MANUAL') {
          expect(c.status).toBe('NEEDS_OWNER_REVIEW');
          await decide<OwnerDecisionResponse>(r.owner, c, 200);
          c = await r.member.detail(c.id);
        }
        expect(c.receipt).toMatchObject({ mode: 'SIMULATED', completionMode: lane });
        expect((await r.db.inspect(c.id)).receiptCount).toBe(1);
      }
      if (age >= 604799) expect(Math.floor(Date.now() / 1000), 'Exact time boundary must stay in the measured second').toBe(at);
      await record(info, r.db, c, `${lane}: amountVnd=${amountVnd}, ageSeconds=${age}`);
    }
  }
  // Keep all snapshot versions fixed and move only real time past the last valid second.
  const expires = Math.floor(Date.now() / 1000) + 2;
  await r.db.patchOrder('demo-e', { amountVnd: 279000, deliveredAt: expires - 604800 });
  const hold = r.db.holdNextEvaluation();
  const request = r.member.intake('demo-e', 'Synthetic crossing of the final commit window');
  try {
    await hold.entered;
    expect(Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(expires);
    await delay((expires + 1) * 1000 - Date.now() + 5);
  } finally { hold.release(); }
  const ack = await request;
  const c = await failed(r.member, ack.caseId, ack.evaluationOperationId);
  expect(c.receipt).toBeNull();
  expect((await r.db.inspect(c.id)).receiptCount).toBe(0);
  await record(info, r.db, c, 'Delivery window expired between policy evaluation and D1 commit');
});

matrix('E-N04', 'Unknown and future delivery times block monetary decisions', async (r, info) => {
  await learnD(r);
  for (const deliveredAt of [null, Math.floor(Date.now() / 1000) + 3600]) {
    await r.db.patchOrder('demo-e', { deliveredAt });
    const c = await intake(r.member);
    expect(c.order.deliveredAt).toBe(deliveredAt);
    expect(c.reasons).toContain('OUTSIDE_POLICY_WINDOW');
    await assertBlocked(r, c);
    await record(info, r.db, c, deliveredAt === null ? 'Missing delivery time' : 'Future delivery time');
  }
});

matrix('E-N05', 'Learned fit rule requires both predicate fields and current verified proof', async (r, info) => {
  const e = await intake(r.member);
  const { d, rule } = await learnD(r);
  for (const [reasonGroup, itemCondition] of [
    ['DAMAGE', e.order.itemCondition], [e.order.reasonGroup, 'DAMAGED']
  ]) {
    await r.db.patchOrder(e.order.id, { reasonGroup, itemCondition });
    const c = await evaluate(r.member, e.id);
    expect(c.appliedRuleId).toBeNull();
    expect(c.receipt).toBeNull();
    expect((await r.db.inspect(e.id)).receiptCount).toBe(0);
    await record(info, r.db, c, `${reasonGroup}/${itemCondition}`);
  }
  await r.db.patchOrder(e.order.id, { reasonGroup: e.order.reasonGroup, itemCondition: e.order.itemCondition });
  const proof = e.evidence.find(p => p.type === 'ITEM_CONDITION' && p.reviewStatus === 'VERIFIED')!;
  await r.db.patchEvidence(e.id, proof.id, { reviewStatus: 'SUBMITTED' });
  const missing = await evaluate(r.member, e.id);
  expect(missing.status).toBe('WAITING_EVIDENCE');
  expect(missing.appliedRuleId).toBeNull();
  expect(missing.receipt).toBeNull();
  await record(info, r.db, missing, 'Required proof unverified');
  await r.db.patchEvidence(e.id, proof.id, { reviewStatus: 'VERIFIED' });
  const good = await evaluate(r.member, e.id);
  expect(good.order.id).not.toBe(d.order.id);
  expect(good.order.amountVnd).not.toBe(d.order.amountVnd);
  expect(good.receipt).toMatchObject({ mode: 'SIMULATED', completionMode: 'AUTO', appliedRuleId: rule.ruleId, sourceCaseId: d.id });
  await record(info, r.db, good, 'Different order and price, matching predicate and verified proof');
});

matrix('AGENT-N01', 'Seven offline provider faults fail closed and preserve intake acknowledgements', async (r, info) => {
  for (const [mode, errorCode] of [
    ['missing-key', 'MODEL_NOT_CONFIGURED'], ['provider-error', 'PROVIDER_ERROR'], ['timeout', 'MODEL_TIMEOUT'],
    ['refusal', 'INVALID_MODEL_RESPONSE'], ['invalid-args', 'INVALID_TOOL_CALL'],
    ['tool-budget', 'TOOL_BUDGET_EXCEEDED'], ['round-budget', 'ROUND_BUDGET_EXCEEDED']
  ] as const) {
    r.db.configureAgent(mode);
    const key = randomUUID();
    const claim = 'Synthetic offline agent fault';
    const ack = await r.member.intake('demo-a', claim, key);
    const c = await failed(r.member, ack.caseId, ack.evaluationOperationId);
    expect(c.status).toBe('TECHNICAL_ERROR');
    expect(c.evaluation).toMatchObject({ error: { code: errorCode }, result: null });
    expect(JSON.stringify(c)).not.toContain('synthetic-private-provider-body');
    expect(JSON.stringify(c)).not.toContain('synthetic-test-value');
    expect(c.receipt).toBeNull();
    expect(await r.member.intake('demo-a', claim, key)).toEqual(ack);
    expect(await r.db.inspect(c.id)).toMatchObject({ evaluationCount: 1, receiptCount: 0, ruleCount: 0 });
    expect((await queue(r.owner)).suggestions.some(s => s.sourceCaseId === c.id)).toBe(false);
    await record(info, r.db, c, `Offline provider fault: ${mode}`);
  }
});

matrix('AGENT-N02', 'The real agent tool allowlist rejects an attempted rule approval', async (r, info) => {
  const before = await queue(r.owner);
  r.db.configureAgent('unauthorized-tool');
  const ack = await r.member.intake('demo-d', 'Synthetic unauthorized tool proposal');
  const c = await failed(r.member, ack.caseId, ack.evaluationOperationId);
  expect(c.evaluation?.error?.code).toBe('INVALID_TOOL_CALL');
  expect(c.status).toBe('TECHNICAL_ERROR');
  expect(c.decision).toBeNull();
  expect(c.receipt).toBeNull();
  expect(await queue(r.owner)).toEqual(before);
  expect(await r.db.inspect(c.id)).toMatchObject({ receiptCount: 0, ruleCount: 0, activeRulesVersion: before.activeRulesVersion });
  await record(info, r.db, c, 'Offline provider attempted unauthorized approve_rule');
});

matrix('AGENT-N03', 'Manual recovery preserves the failed evaluation and skips learning', async (r, info) => {
  r.db.configureAgent('provider-error');
  for (const eligible of [true, false]) {
    if (!eligible) await r.db.patchOrder('demo-d', { amountVnd: 300001 });
    const key = randomUUID();
    const claim = 'Synthetic owner recovery';
    const ack = await r.member.intake('demo-d', claim, key);
    const c = await failed(r.member, ack.caseId, ack.evaluationOperationId);
    expect(c.status).toBe('TECHNICAL_ERROR');
    if (eligible) {
      const result = await decide<OwnerDecisionResponse>(r.owner, c, 200);
      expect(result.receipt).toMatchObject({ completionMode: 'MANUAL', mode: 'SIMULATED', agentRunId: null });
      expect(result.suggestionId).toBeNull();
    } else expect((await decide<ApiError>(r.owner, c, 409)).error.code).toBe('POLICY_BLOCKED');
    const after = await r.member.detail(c.id);
    expect(after.status).toBe(eligible ? 'COMPLETED' : 'TECHNICAL_ERROR');
    expect(after.evaluation).toEqual(c.evaluation);
    expect(after.timeline.some(t => t.evaluationStatus === 'FAILED')).toBe(true);
    expect(after.timeline.some(t => t.evaluationStatus === 'COMPLETED' && t.executionMode === 'LIVE')).toBe(false);
    expect(await r.member.intake('demo-d', claim, key)).toEqual(ack);
    expect((await queue(r.owner)).suggestions.some(s => s.sourceCaseId === c.id)).toBe(false);
    expect(await r.db.inspect(c.id)).toMatchObject({ receiptCount: eligible ? 1 : 0, ruleCount: 0, evaluationCount: 1 });
    await record(info, r.db, after, eligible ? 'Eligible manual recovery' : 'Over-cap manual recovery blocked');
  }
});

matrix('R-N06', 'An active evaluation rejects a competing key and can recover after a terminal failure', async (r, info) => {
  const c = await intake(r.member, 'demo-d');
  const path = `/api/cases/${c.id}/evaluate`;
  const key = randomUUID();
  const body = versions(c);
  const count = (await r.db.inspect(c.id)).evaluationCount;
  r.db.configureAgent('provider-error');
  const hold = r.db.holdNextEvaluation();
  const first = r.member.call<EvaluateAcknowledgement>('POST', path, 202, body, key);
  let replay: EvaluateAcknowledgement;
  try {
    await hold.entered;
    const running = await r.member.detail(c.id);
    expect(running.pendingEvaluationOperationId).toBeTruthy();
    replay = await r.member.call<EvaluateAcknowledgement>('POST', path, 202, body, key);
    expect(replay.operationId).toBe(running.pendingEvaluationOperationId);
    const competing = await r.member.call<ApiError>('POST', path, 409, versions(running));
    expect(competing.error.code).toBe('CASE_BUSY');
  } finally { hold.release(); }
  const ack = await first;
  expect(ack).toEqual(replay!);
  const failure = await failed(r.member, c.id, ack.operationId);
  expect(failure.evaluation?.error?.code).toBe('PROVIDER_ERROR');
  expect(await r.member.call<EvaluateAcknowledgement>('POST', path, 202, body, key)).toEqual(ack);
  expect((await r.db.inspect(c.id)).evaluationCount).toBe(count + 1);
  await record(info, r.db, failure, 'Active evaluation: original replay 202, competitor CASE_BUSY');
  r.db.configureAgent('ok');
  const recovered = await evaluate(r.member, c.id);
  expect(recovered.evaluation?.id).not.toBe(ack.operationId);
  expect(recovered.status).toBe('NEEDS_OWNER_REVIEW');
  expect(await r.db.inspect(c.id)).toMatchObject({ evaluationCount: count + 2, receiptCount: 0 });
  await record(info, r.db, recovered, 'Fresh key after terminal failure');
});
