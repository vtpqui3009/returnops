/* eslint-disable @typescript-eslint/no-require-imports -- Node regression harness. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHttpApi, evaluationJob, evidenceReviewJob, intent } = require('../../work/ui-tests/features/returnops/api.js');
const { evaluationIsActive, evaluationHasFailed, timelinePresentation } = require('../../work/ui-tests/features/returnops/presentation.js');
const { createTestApi, seedTestStore } = require('../../work/ui-tests/features/returnops/test-adapter.js');
const { recoveryFixture } = require('./recovery-fixture.cjs');

for (const action of ['evaluate', 'review']) for (const pendingStatus of ['PENDING', 'RUNNING']) {
  test(`${action}: acknowledged ${pendingStatus} dispatch failure recovers by same POST replay; GET never drives work`, async () => {
    const fixture = recoveryFixture({ action, pendingStatus });
    const api = createHttpApi(fixture.fetcher), signal = new AbortController().signal;
    const request = intent({ expectedCaseVersion: fixture.state.caseVersion, expectedEvidenceVersion: 1, reviewStatus: 'VERIFIED', reason: 'Đã đối chiếu nguồn hiện hành' });
    const options = { interval: 1, timeout: 10 };
    const job = action === 'evaluate' ? evaluationJob(api, fixture.state.id, undefined, options) : evidenceReviewJob(api, fixture.state.id, 'proof-1', request, undefined, options);
    await assert.rejects(job(signal), error => error.code === 'POLL_TIMEOUT');
    assert.equal(fixture.counts.operationCount, 1);
    assert.equal(fixture.counts.receiptCount, 0);
    const durable = structuredClone(fixture.state);
    await api.detail(fixture.state.id); await api.detail(fixture.state.id);
    assert.deepEqual(fixture.state, durable, 'GET cannot recover dispatch or mutate snapshots');
    const done = await job(signal);
    assert.equal(done.receipt.mode, 'SIMULATED');
    assert.equal(fixture.posts.length, 2);
    assert.equal(fixture.posts[0].key, fixture.posts[1].key);
    assert.deepEqual(fixture.posts[0].body, fixture.posts[1].body);
    assert.equal(done.evaluation.id, durable.evaluation.id);
    await job(signal); // completed replay remains one operation and receipt
    assert.equal(fixture.counts.operationCount, 1);
    assert.equal(fixture.counts.receiptCount, 1);
    if (action === 'review') assert.equal(done.evidence[0].evidenceVersion, 2, 'review is not applied twice');
  });
}

test('matching FAILED snapshot-fenced operation is terminal despite retained pointer; older failure cannot unlock newer work', () => {
  const c = recoveryFixture().state;
  c.pendingEvaluationOperationId = 'stale-op';
  c.evaluation = { id: 'stale-op', status: 'FAILED', error: { code: 'STALE_EVALUATION', message: 'Snapshot changed' } };
  assert.equal(evaluationIsActive(c), false);
  assert.equal(evaluationHasFailed(c), true);
  c.pendingEvaluationOperationId = 'newer-op';
  assert.equal(evaluationIsActive(c), true);
  assert.equal(evaluationHasFailed(c), false);
  for (const status of ['PENDING', 'RUNNING']) { c.evaluation = { id: 'newer-op', status }; assert.equal(evaluationIsActive(c), true); }
});

test('TEST rejects REJECTED/VERIFIED review transitions with fresh versions and accepts separate replacement submission', async () => {
  const store = seedTestStore(), api = createTestApi(store, () => {}, 0), c = store.cases['demo-c'], proof = c.evidence[0];
  await api.review(c.id, proof.id, intent({ expectedCaseVersion: c.caseVersion, expectedEvidenceVersion: proof.evidenceVersion, reviewStatus: 'REJECTED', reason: 'Không đủ căn cứ' }));
  const before = structuredClone(c);
  for (const reviewStatus of ['VERIFIED', 'REJECTED']) await assert.rejects(api.review(c.id, proof.id, intent({ expectedCaseVersion: c.caseVersion, expectedEvidenceVersion: proof.evidenceVersion, reviewStatus, reason: 'Cannot reopen' })), e => e.status === 409);
  assert.deepEqual(c, before);
  const added = await api.evidence(c.id, intent({ expectedCaseVersion: c.caseVersion, orderId: c.order.id, orderVersion: c.order.orderVersion, tracking: c.order.tracking, type: 'DELIVERY', source: 'CARRIER', reference: 'Tham chiếu vận chuyển thay thế', observedAt: 1 }));
  assert.notEqual(added.evidenceId, proof.id);
  assert.equal(proof.reviewStatus, 'REJECTED');
  const replacement = c.evidence.find(e => e.id === added.evidenceId);
  assert.equal(replacement.reviewStatus, 'SUBMITTED');
  await api.review(c.id, replacement.id, intent({ expectedCaseVersion: c.caseVersion, expectedEvidenceVersion: replacement.evidenceVersion, reviewStatus: 'VERIFIED', reason: 'New proof reviewed' }));
  await assert.rejects(api.review(c.id, replacement.id, intent({ expectedCaseVersion: c.caseVersion, expectedEvidenceVersion: replacement.evidenceVersion, reviewStatus: 'VERIFIED', reason: 'Cannot review twice' })), e => e.status === 409);
});

test('TEST detail is read-only, including pending evaluations and active catalog', async () => {
  const store = seedTestStore(), c = store.cases['demo-e'];
  c.pendingEvaluationOperationId = 'pending'; c.evaluation = { id: 'pending', status: 'PENDING' };
  store.rules.activeRulesVersion = 3;
  const before = structuredClone(store), api = createTestApi(store, () => { throw Error('GET must not save'); }, 0);
  const first = await api.detail(c.id), second = await api.detail(c.id);
  assert.equal(first.evaluation.status, 'PENDING'); assert.equal(second.activeRulesVersion, 3);
  assert.deepEqual(store, before);
});

test('canonical backend timeline labels failures, progress and success distinctly', () => {
  for (const type of ['case.intake', 'evidence.submitted', 'evidence.reviewed', 'owner.decision', 'evaluation.requested', 'evaluation.completed', 'evaluation.failed']) assert.notEqual(timelinePresentation({ type, evaluationStatus: null }).label, 'Cập nhật hồ sơ');
  assert.equal(timelinePresentation({ type: 'evaluation.failed', evaluationStatus: 'FAILED' }).tone, 'error');
  assert.equal(timelinePresentation({ type: 'new.server.event', evaluationStatus: 'FAILED' }).tone, 'error');
  assert.equal(timelinePresentation({ type: 'evaluation.requested', evaluationStatus: 'PENDING' }).tone, 'progress');
  assert.equal(timelinePresentation({ type: 'evaluation.completed', evaluationStatus: 'COMPLETED' }).tone, 'success');
  assert.equal(timelinePresentation({ type: 'unknown', evaluationStatus: null }).tone, 'neutral');
  assert.equal(timelinePresentation({ type: 'owner.decision', evaluationStatus: 'FAILED' }).label, 'Đã lưu quyết định của chủ shop', 'old evaluation metadata must not relabel a later owner action');
});
