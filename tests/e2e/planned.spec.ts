import { expect, test as base, type Page } from '@playwright/test';
import { ApiClient, validateOrigin, waitForEvaluation } from '../support/api';
import type { CaseDetail, OwnerDecisionResponse } from '../../src/shared/contracts';

type OwnerRuntime = { owner: ApiClient; cookie: string };
const test = base.extend<{ ownerRuntime: OwnerRuntime }>({
  ownerRuntime: async ({}, provide) => {
    const origin = validateOrigin(process.env['RETURNOPS_TEST_' + 'BASE_URL'] ?? '', process.env['RETURNOPS_TEST_' + 'ALLOW_REMOTE'] === '1');
    const signIn = await fetch(`${origin}/signin-with-chatgpt`, { redirect: 'manual' });
    const cookie = signIn.headers.get('set-cookie')?.split(';')[0];
    if (signIn.status !== 302 || !cookie) throw new Error('NOT RUN: local owner profile is unavailable.');
    await provide({ cookie, owner: new ApiClient(origin, { Cookie: cookie }, false, 45_000) });
  },
});

// The owner fixture signs in through local Sites. Browser assertions use the
// Vinext page and same-origin app/api routes without interception.
test.afterEach(async ({ page }) => page.close());

async function signInAsOwner(page: Page, runtime: OwnerRuntime) {
  const cookie = runtime.cookie;
  const separator = cookie.indexOf('=');
  await page.context().addCookies([{ url: runtime.owner.origin, name: cookie.slice(0, separator), value: cookie.slice(separator + 1) }]);
  await page.goto(runtime.owner.origin);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Mỗi yêu cầu');
}

async function createLiveCase(runtime: OwnerRuntime, order: string, claim: string) {
  const acknowledgement = await runtime.owner.intake(order, claim);
  const detail = await waitForEvaluation(runtime.owner, acknowledgement.caseId, acknowledgement.evaluationOperationId);
  expect(detail.evaluation?.executionMode).toBe('LIVE');
  return detail;
}

async function openCase(page: Page, detail: CaseDetail, claim: string) {
  await page.getByRole('button', { name: claim, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: claim })).toBeVisible();
  return detail;
}

test.describe('A-01', () => {
test('browser observes same-origin LIVE intake outcome', { annotation: { type: 'matrix-id', description: 'A-01' } }, async ({ page, ownerRuntime }, info) => {
  const claim = 'Full-route LIVE A';
  const detail = await createLiveCase(ownerRuntime, 'demo-a', claim);
  await signInAsOwner(page, ownerRuntime);
  await openCase(page, detail, claim);
  await expect(page.getByText('Biên nhận mô phỏng', { exact: true })).toBeVisible({ timeout: 35_000 });
  await page.reload();
  await openCase(page, detail, claim);
  await expect(page.getByText(detail.receipt!.id, { exact: false })).toBeVisible();
  await info.attach('full-route-observation', { contentType: 'application/json', body: JSON.stringify({ caseId: detail.id, operationId: detail.evaluation?.id, executionMode: detail.evaluation?.executionMode, receiptId: detail.receipt?.id }) });
});
});

test.describe('B-03', () => {
test('browser adds and verifies replacement evidence through full app', { annotation: { type: 'matrix-id', description: 'B-03' } }, async ({ page, ownerRuntime }, info) => {
  const claim = 'Full-route LIVE B';
  const detail = await createLiveCase(ownerRuntime, 'demo-b', claim);
  await signInAsOwner(page, ownerRuntime);
  await openCase(page, detail, claim);
  await page.getByLabel('Thông tin tham chiếu (bắt buộc)', { exact: true }).fill('Approved synthetic full-route packing reference');
  await page.getByLabel('Mã vận đơn trên bằng chứng (bắt buộc)', { exact: true }).fill(detail.order.tracking);
  await page.getByRole('button', { name: 'Thêm bằng chứng', exact: true }).click();
  await page.getByRole('button', { name: 'Chủ shop xem xét', exact: true }).click();
  await page.getByLabel('Kết quả đối chiếu (bắt buộc)', { exact: true }).fill('Approved synthetic full-route review');
  await page.getByRole('button', { name: 'Xác minh bằng chứng', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByText('Biên nhận mô phỏng', { exact: true })).toBeVisible({ timeout: 35_000 });
  const result = await ownerRuntime.owner.detail(detail.id);
  await info.attach('full-route-observation', { contentType: 'application/json', body: JSON.stringify({ caseId: result.id, operationId: result.evaluation?.id, executionMode: result.evaluation?.executionMode, receiptId: result.receipt?.id }) });
});
});

test.describe('C-01', () => {
test('owner verifies carrier proof then disputes through full app', { annotation: { type: 'matrix-id', description: 'C-01' } }, async ({ page, ownerRuntime }, info) => {
  const claim = 'Full-route LIVE C';
  const detail = await createLiveCase(ownerRuntime, 'demo-c', claim);
  await signInAsOwner(page, ownerRuntime);
  await openCase(page, detail, claim);
  await page.getByRole('button', { name: 'Chủ shop xem xét', exact: true }).click();
  await page.getByLabel('Kết quả đối chiếu (bắt buộc)', { exact: true }).fill('Approved synthetic full-route review');
  await page.getByRole('button', { name: 'Xác minh bằng chứng', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await page.getByLabel('Hướng xử lý do bạn chọn').selectOption('DISPUTE');
  await page.getByLabel('Lý do quyết định (bắt buộc)', { exact: true }).fill('Approved synthetic full-route decision');
  await page.getByRole('button', { name: 'Duyệt xử lý đơn này', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByText('Biên nhận mô phỏng', { exact: true })).toBeVisible({ timeout: 35_000 });
  const result = await ownerRuntime.owner.detail(detail.id);
  expect(result.receipt).toMatchObject({ completionMode: 'MANUAL', mode: 'SIMULATED', agentRunId: null });
  await info.attach('full-route-observation', { contentType: 'application/json', body: JSON.stringify({ caseId: result.id, flags: result.flags, receiptId: result.receipt?.id }) });
});
});

test.describe('D-01', () => {
test('owner decision remains a manual simulated receipt', { annotation: { type: 'matrix-id', description: 'D-01' } }, async ({ page, ownerRuntime }, info) => {
  const claim = 'Full-route LIVE D';
  const detail = await createLiveCase(ownerRuntime, 'demo-d', claim);
  await signInAsOwner(page, ownerRuntime);
  await openCase(page, detail, claim);
  await page.getByRole('button', { name: 'Chủ shop xem xét', exact: true }).click();
  await page.getByLabel('Hướng xử lý do bạn chọn').selectOption('RETURN_THEN_REFUND');
  await page.getByLabel('Lý do quyết định (bắt buộc)', { exact: true }).fill('Approved synthetic full-route decision');
  await page.getByRole('button', { name: 'Duyệt xử lý đơn này', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByText('Biên nhận mô phỏng', { exact: true })).toBeVisible({ timeout: 35_000 });
  const result = await ownerRuntime.owner.detail(detail.id);
  expect(result.receipt).toMatchObject({ completionMode: 'MANUAL', mode: 'SIMULATED', agentRunId: null });
  await info.attach('full-route-observation', { contentType: 'application/json', body: JSON.stringify({ caseId: result.id, receiptId: result.receipt?.id, status: result.status }) });
});
});

test('E-02: owner accepts a rule then browser requests a fresh evaluation', { annotation: { type: 'matrix-id', description: 'E-02' } }, async ({ page, ownerRuntime }, info) => {
  const source = await createLiveCase(ownerRuntime, 'demo-d', 'Synthetic fit return: unused item with tags intact; customer requests a return and refund.');
  const decision = await ownerRuntime.owner.call<OwnerDecisionResponse>('POST', `/api/cases/${source.id}/owner-decision`, 200, {
    expectedCaseVersion: source.caseVersion,
    expectedActiveRulesVersion: source.activeRulesVersion,
    decision: 'RETURN_THEN_REFUND',
    reason: 'Create a synthetic rule candidate for E',
  });
  await info.attach('e-learning-eligibility', { contentType: 'application/json', body: JSON.stringify({
    caseId: source.id,
    orderId: source.order.id,
    amountVnd: source.order.amountVnd,
    reasonGroup: source.order.reasonGroup,
    itemCondition: source.order.itemCondition,
    status: source.status,
    reasons: source.reasons,
    flags: source.flags,
    evaluation: source.evaluation && { status: source.evaluation.status, executionMode: source.evaluation.executionMode, model: source.evaluation.model },
    suggestionId: decision.suggestionId,
  }) });
  if (!decision.suggestionId) console.log(JSON.stringify({ eLearning: { reasons: source.reasons, flags: source.flags, status: source.status, evaluationStatus: source.evaluation?.status, executionMode: source.evaluation?.executionMode, suggestionId: null } }));
  test.skip(!decision.suggestionId, 'NOT RUN: this LIVE provider result is not an eligible learning candidate, so rule acceptance/fresh-evaluation provenance cannot be asserted.');
  const targetClaim = 'Full-route LIVE E target';
  const target = await createLiveCase(ownerRuntime, 'demo-e', targetClaim);
  await signInAsOwner(page, ownerRuntime);
  await expect(page.getByRole('button', { name: targetClaim, exact: true })).toBeVisible();
  const rulesRead = page.waitForResponse(response => response.url() === `${ownerRuntime.owner.origin}/api/rule-suggestions` && response.request().method() === 'GET');
  await page.getByRole('button', { name: 'Quy tắc của shop', exact: true }).click();
  expect((await rulesRead).status()).toBe(200);
  await page.getByRole('button', { name: 'Áp dụng quy tắc cho đơn sau', exact: true }).click({ timeout: 35_000 });
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await page.getByRole('button', { name: 'Hàng chờ', exact: true }).click();
  await openCase(page, target, targetClaim);
  await page.getByRole('button', { name: 'Đánh giá lại yêu cầu', exact: true }).click();
  await expect(page.getByText('Biên nhận mô phỏng', { exact: true })).toBeVisible({ timeout: 35_000 });
  const result = await ownerRuntime.owner.detail(target.id);
  expect(result.receipt?.sourceCaseId).toBe(source.id);
  await info.attach('full-route-observation', { contentType: 'application/json', body: JSON.stringify({ caseId: result.id, sourceCaseId: result.receipt?.sourceCaseId, receiptId: result.receipt?.id }) });
});

test('AUTH-N01: app route rejects anonymous and spoofed identity headers', { annotation: { type: 'matrix-id', description: 'AUTH-N01' } }, async ({ ownerRuntime }) => {
  const anonymous = await fetch(`${ownerRuntime.owner.origin}/api/cases?limit=1`);
  expect(anonymous.status).toBe(401);
  const spoofed = await fetch(`${ownerRuntime.owner.origin}/api/cases?limit=1`, {
    headers: { 'oai-authenticated-user-id': 'local_seedy', 'oai-authenticated-user-email': 'seedy@sites.test' },
  });
  expect(spoofed.status).toBe(401);
});

test('UI-N02: same key replays a committed owner decision and stale version conflicts', { annotation: { type: 'matrix-id', description: 'UI-N02' } }, async ({ ownerRuntime }) => {
  const replay = await createLiveCase(ownerRuntime, 'demo-d', 'Full-route replay decision');
  const payload = { expectedCaseVersion: replay.caseVersion, expectedActiveRulesVersion: replay.activeRulesVersion, decision: 'RETURN_THEN_REFUND', reason: 'Replay must preserve one receipt' } as const;
  const first = await ownerRuntime.owner.request<OwnerDecisionResponse>('POST', `/api/cases/${replay.id}/owner-decision`, [200], payload, 'full-route-replay-key');
  const afterFirst = await ownerRuntime.owner.detail(replay.id);
  const second = await ownerRuntime.owner.request<OwnerDecisionResponse>('POST', `/api/cases/${replay.id}/owner-decision`, [200], payload, 'full-route-replay-key');
  const afterSecond = await ownerRuntime.owner.detail(replay.id);
  expect(second.body).toEqual(first.body);
  expect(afterSecond.receipt?.id).toBe(afterFirst.receipt?.id);

  const stale = await createLiveCase(ownerRuntime, 'demo-d', 'Full-route stale decision');
  const stalePayload = { expectedCaseVersion: stale.caseVersion, expectedActiveRulesVersion: stale.activeRulesVersion, decision: 'RETURN_THEN_REFUND', reason: 'Intent becomes stale before commit' } as const;
  const evaluation = await ownerRuntime.owner.evaluate(stale.id);
  await waitForEvaluation(ownerRuntime.owner, stale.id, evaluation.operationId);
  const conflict = await ownerRuntime.owner.request('POST', `/api/cases/${stale.id}/owner-decision`, [409], stalePayload, 'full-route-stale-key');
  expect((conflict.body as { error: { code: string } }).error.code).toBe('STALE_VERSION');
});

for (const id of ['E-01']) {
  test(`${id}: full-route owner-only coverage is not implemented`, { annotation: { type: 'matrix-id', description: id } }, async () => {
    test.skip(true, 'NOT RUN: requires a dedicated safe scenario or protected-preview role session; local owner-only evidence cannot substitute.');
  });
}
