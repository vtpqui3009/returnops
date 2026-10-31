import type { Route } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { waitForEvaluation } from '../support/api';
import type { CaseDetail, EvidenceAcknowledgement, ReviewAcknowledgement, ReviewEvidenceRequest } from '../../src/shared/contracts';

test.use({ scenario: 'B' });
test.afterEach(async ({ page }) => { await page.close(); });

test('UI-N01: a durable review acknowledgement stays in progress until evaluation completes', {
  annotation: { type: 'matrix-id', description: 'UI-N01' }
}, async ({ page, runtime }, info) => {
  const { member, owner, localD1 } = runtime;
  test.skip(!localD1, 'Requires the disposable D1 fixture and its agent gate.');
  const claim = 'Pending review acknowledgement';
  const intake = await member.intake('demo-b', claim);
  const b = await waitForEvaluation(member, intake.caseId, intake.evaluationOperationId);
  const path = `/api/cases/${b.id}`;
  const proof = await member.call<EvidenceAcknowledgement>('POST', `${path}/evidence`, 201, {
    expectedCaseVersion: b.caseVersion, orderId: b.order.id, orderVersion: b.order.orderVersion, tracking: b.order.tracking,
    source: 'SELLER', type: 'PACKING', reference: 'Synthetic packing slip', observedAt: Math.floor(Date.now() / 1000)
  });
  const cookie = runtime.headers.OWNER.Cookie;
  const separator = cookie.indexOf('=');
  await page.context().addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: owner.origin }]);
  await page.goto(owner.origin);
  await page.getByRole('button', { name: claim, exact: true }).click();
  await page.getByRole('button', { name: 'Chủ shop xem xét', exact: true }).click();
  await page.getByLabel('Kết quả đối chiếu (bắt buộc)', { exact: true }).fill('Synthetic browser review');
  await page.getByRole('button', { name: 'Xác minh bằng chứng', exact: true }).click();

  const reviewPath = `${path}/evidence/${proof.evidenceId}/review`;
  let capture!: (route: Route) => void;
  const intercepted = new Promise<Route>(resolve => { capture = resolve; });
  await page.route(owner.origin + reviewPath, capture);
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  const route = await intercepted;
  const key = route.request().headers()['idempotency-key'];
  expect(key).toBeTruthy();
  expect(route.request().method()).toBe('POST');
  const intent = route.request().postDataJSON() as ReviewEvidenceRequest;
  const hold = localD1!.holdNextEvaluation();
  // Deliver the genuine committed HTTP acknowledgement early, before the dispatcher's awaited agent returns.
  const dispatched = owner.call<ReviewAcknowledgement>('POST', reviewPath, 200, intent, key)
    .then(value => ({ value }), (error: unknown) => ({ error }));
  let ack: ReviewAcknowledgement;
  try {
    await hold.entered;
    ack = await localD1!.readReviewAcknowledgement(key);
    expect(ack).toMatchObject({ evidenceId: proof.evidenceId, reviewStatus: 'VERIFIED' });
    expect(ack.evaluationOperationId).toBeTruthy();
    await route.fulfill({ status: 200, json: ack });
    await expect(page.getByText('Đánh giá: Đang chạy', { exact: true })).toBeVisible();
    // A second detail read proves that the browser continues polling after its first RUNNING render.
    const response = await page.waitForResponse(r => r.url() === owner.origin + path && r.request().method() === 'GET' && r.ok());
    const pending = await response.json() as CaseDetail;
    expect(pending.evaluation).toMatchObject({ id: ack.evaluationOperationId, status: 'RUNNING' });
    expect(pending.receipt).toBeNull();
    await expect(page.getByRole('heading', { name: 'Đang đánh giá yêu cầu', exact: true })).toBeVisible();
    await expect(page.getByText('Biên nhận mô phỏng', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Đã xử lý', { exact: true })).toHaveCount(0);
    const state = await localD1!.inspect(b.id);
    expect(state.receiptCount).toBe(0);
    await info.attach('ui-observation', { contentType: 'application/json', body: JSON.stringify({
      caseId: b.id, caseStatus: pending.status, receiptId: null, ...state
    }) });
  } finally { hold.release(); }
  const dispatchResult = await dispatched;
  if ('error' in dispatchResult) throw dispatchResult.error;
  expect(dispatchResult.value).toEqual(ack!);
  await expect(page.getByText('Biên nhận mô phỏng', { exact: true })).toBeVisible();
  const done = await member.detail(b.id);
  expect(done.evaluation).toMatchObject({ id: ack!.evaluationOperationId, status: 'COMPLETED' });
  expect(done.receipt).toMatchObject({ mode: 'SIMULATED', completionMode: 'AUTO' });
  const state = await localD1!.inspect(b.id);
  expect(state.receiptCount).toBe(1);
  await info.attach('ui-observation', { contentType: 'application/json', body: JSON.stringify({
    caseId: b.id, caseStatus: done.status, receiptId: done.receipt!.id, ...state
  }) });
});
