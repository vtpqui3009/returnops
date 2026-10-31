import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import type { CaseDetail, OwnerDecisionResponse, RuleSuggestionQueueResponse } from '../../src/shared/contracts';
import { test, expect } from '../support/fixtures';
import { waitForEvaluation, type ApiClient } from '../support/api';
import { MAIN_FLOW_IDS } from '../support/catalog';
import type { PreparedScenario } from '../support/types';

// Stop browser polling/keepalive before the disposable HTTP/D1 fixture is drained.
test.afterEach(async ({ page }) => { await page.close(); });

async function start(page: Page, runtime: PreparedScenario & { owner: ApiClient }) {
  const cookie = runtime.headers.OWNER.Cookie;
  const separator = cookie.indexOf('=');
  await page.context().addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: runtime.owner.origin }]);
  await page.goto(runtime.owner.origin);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Mỗi yêu cầu');
}
async function seed(api: ApiClient, order: string) {
  const ack = await api.intake(order, `Browser integration ${order}`);
  return waitForEvaluation(api, ack.caseId, ack.evaluationOperationId);
}
async function open(page: Page, order: string) {
  await page.locator('.case-row').filter({ hasText: order }).getByRole('button', { name: `Browser integration ${order}`, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`Browser integration ${order}`);
}
async function confirm(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function decide(page: Page, value: 'DISPUTE' | 'RETURN_THEN_REFUND') {
  await page.getByRole('button', { name: 'Chủ shop xem xét', exact: true }).click();
  await page.getByLabel('Hướng xử lý do bạn chọn').selectOption(value);
  await page.getByLabel('Lý do quyết định (bắt buộc)', { exact: true }).fill('Synthetic browser owner decision');
  await page.getByRole('button', { name: 'Duyệt xử lý đơn này', exact: true }).click();
  await confirm(page);
}
async function addProof(page: Page, c: CaseDetail, reference = 'Browser packing reference') {
  await page.getByLabel('Thông tin tham chiếu (bắt buộc)', { exact: true }).fill(reference);
  await page.getByLabel('Mã vận đơn trên bằng chứng (bắt buộc)', { exact: true }).fill(c.order.tracking);
  await page.getByRole('button', { name: 'Thêm bằng chứng', exact: true }).click();
  await expect(page.getByText(reference, { exact: true })).toBeVisible();
}
async function verify(page: Page) {
  await page.getByRole('button', { name: 'Chủ shop xem xét', exact: true }).click();
  await page.getByLabel('Kết quả đối chiếu (bắt buộc)', { exact: true }).fill('Synthetic browser evidence review');
  await page.getByRole('button', { name: 'Xác minh bằng chứng', exact: true }).click();
  await confirm(page);
}

for (const id of MAIN_FLOW_IDS) {
  test(id, { annotation: { type: 'matrix-id', description: id } }, async ({ page, runtime }, info) => {
    const { member, owner, localD1 } = runtime;
    let c: CaseDetail;
    let source: string | null = null;
    if (id.startsWith('E')) {
      const d = await seed(member, 'demo-d');
      source = d.id;
      await owner.call<OwnerDecisionResponse>('POST', `/api/cases/${d.id}/owner-decision`, 200, {
        expectedCaseVersion: d.caseVersion, expectedActiveRulesVersion: d.activeRulesVersion,
        decision: 'RETURN_THEN_REFUND', reason: 'Browser E setup candidate'
      });
      c = await seed(member, 'demo-e');
    } else c = await seed(member, `demo-${id[0].toLowerCase()}`);
    await start(page, runtime);
    await open(page, c.order.id);
    if (id.startsWith('B') && id !== 'B-01') {
      await addProof(page, c);
      await expect(page.getByText('Chờ đối chiếu', { exact: true })).toBeVisible();
      expect((await member.detail(c.id)).status).toBe('WAITING_EVIDENCE');
      expect((await member.detail(c.id)).receipt).toBeNull();
      if (id === 'B-03') await verify(page);
    }
    if (id === 'C-01') {
      await verify(page);
      await decide(page, 'DISPUTE');
      for (const flag of ['Mâu thuẫn giao hàng', 'Nhiều khiếu nại gần đây', 'Vượt ngưỡng tự động']) {
        await expect(page.getByText(flag, { exact: true })).toBeVisible();
      }
      const rules = await owner.call<RuleSuggestionQueueResponse>('GET', '/api/rule-suggestions', 200);
      expect(rules.suggestions.some(s => s.sourceCaseId === c.id)).toBe(false);
    }
    if (id === 'D-01') await decide(page, 'RETURN_THEN_REFUND');
    if (id === 'E-02') {
      await page.getByRole('button', { name: 'Quy tắc của shop', exact: true }).click();
      await expect(page.getByText(`Danh mục v${c.activeRulesVersion}`, { exact: true })).toBeVisible();
      await expect(page.getByText('Chờ bạn duyệt', { exact: true })).toBeVisible();
      await expect(page.locator('.rule-record').getByRole('button', { name: source!, exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Áp dụng quy tắc cho đơn sau', exact: true }).click();
      await confirm(page);
      await expect(page.getByText('Đã áp dụng', { exact: true })).toBeVisible();
      await expect(page.getByText(`Danh mục v${c.activeRulesVersion + 1}`, { exact: true })).toBeVisible();
      expect((await member.detail(c.id)).receipt).toBeNull();
      await page.getByRole('button', { name: 'Hàng chờ', exact: true }).click();
      await open(page, c.order.id);
      await page.getByRole('button', { name: 'Đánh giá lại yêu cầu', exact: true }).click();
    }
    const completes = ['A-01', 'B-03', 'C-01', 'D-01', 'E-02'].includes(id);
    if (completes) {
      await expect(page.getByText('Biên nhận mô phỏng', { exact: true })).toBeVisible();
      const result = await member.detail(c.id);
      expect(result.status).toBe('COMPLETED');
      expect(result.receipt?.mode).toBe('SIMULATED');
      expect(result.decision).toBe(id === 'C-01' ? 'DISPUTE' : 'RETURN_THEN_REFUND');
      if (source) expect(result.receipt?.sourceCaseId).toBe(source);
      const receipt = result.receipt!.id;
      await page.reload();
      await open(page, c.order.id);
      await expect(page.getByText(receipt, { exact: false })).toBeVisible();
      const decision = result.decision === 'DISPUTE' ? 'Khiếu nại yêu cầu hoàn tiền' : 'Nhận hàng trả rồi hoàn tiền';
      await expect(page.locator('.decision-panel').getByRole('heading', { level: 3 })).toHaveText(decision);
      await expect(page.getByText('Đã xử lý', { exact: true })).toBeVisible();
      const mode = result.receipt!.completionMode === 'AUTO' ? 'Xử lý tự động' : 'Chủ shop xử lý';
      await expect(page.locator('.receipt-panel')).toContainText(mode);
      await expect(page.locator('ol')).toContainText('TEST');
      if (result.appliedRuleVersion !== null) {
        await expect(page.getByText(`Quy tắc v${result.appliedRuleVersion} · nguồn ${result.sourceCaseId ?? 'quy tắc shop'}`, { exact: true })).toBeVisible();
      }
    } else {
      await expect(page.getByText('Chưa có biên nhận.', { exact: false })).toBeVisible();
      expect((await member.detail(c.id)).receipt).toBeNull();
    }
    const result = await member.detail(c.id);
    if (!completes) {
      await expect(page.getByText(id.startsWith('B') ? 'Chờ bằng chứng' : 'Chờ chủ shop', { exact: true })).toBeVisible();
    }
    if (id === 'D-01') {
      const catalog = await owner.call<RuleSuggestionQueueResponse>('GET', '/api/rule-suggestions', 200);
      expect(catalog.activeRulesVersion).toBe(c.activeRulesVersion);
      expect(catalog.suggestions.find(s => s.sourceCaseId === c.id)).toMatchObject({ status: 'PENDING', ruleId: null });
      expect(catalog.activeRules.some(rule => rule.sourceCaseId === c.id)).toBe(false);
      await page.getByRole('button', { name: 'Quy tắc của shop', exact: true }).click();
      await expect(page.getByText(`Danh mục v${c.activeRulesVersion}`, { exact: true })).toBeVisible();
      await expect(page.getByText('Chờ bạn duyệt', { exact: true })).toBeVisible();
      await expect(page.locator('.rule-record').getByRole('button', { name: c.id, exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Hàng chờ', exact: true }).click();
      await open(page, c.order.id);
    }
    const decisionText = await page.locator('.decision-panel').getByRole('heading', { level: 3 }).innerText();
    const provenance = page.getByText(/^Quy tắc v\d+ · nguồn /);
    const completion = page.locator('.receipt-panel .small');
    await info.attach('ui-observation', { contentType: 'application/json', body: JSON.stringify({
      caseId: c.id, caseStatus: result.status, receiptId: result.receipt?.id ?? null,
      decisionText, provenanceText: await provenance.count() ? await provenance.innerText() : null,
      completionText: await completion.count() ? await completion.innerText() : null,
      sourceCaseId: result.sourceCaseId, ...await localD1!.inspect(c.id)
    }) });
  });
}

test('UI-N01: failed write retries the same browser intent', { annotation: [{ type: 'matrix-id', description: 'UI-N01' }, { type: 'matrix-variant', description: 'write-retry' }] }, async ({ page, runtime }) => {
  const c = await seed(runtime.member, 'demo-d');
  await start(page, runtime); await open(page, c.order.id);
  const requests: { key: string | undefined; body: string | null }[] = [];
  await page.route('**/api/cases/*/owner-decision', async route => {
    requests.push({ key: route.request().headers()['idempotency-key'], body: route.request().postData() });
    if (requests.length === 1) await route.abort(); else await route.continue();
  });
  await decide(page, 'RETURN_THEN_REFUND');
  await expect(page.getByRole('alert')).toContainText('Chưa hoàn tất thao tác');
  expect((await runtime.owner.detail(c.id)).receipt).toBeNull();
  await page.getByRole('button', { name: 'Thử lại thao tác đã xác nhận', exact: true }).click();
  await confirm(page);
  await expect(page.getByText('Biên nhận mô phỏng', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(requests[0].key).toBeTruthy();
});

test('UI-N02: stale decision shows conflict and reloads current versions', { annotation: { type: 'matrix-id', description: 'UI-N02' } }, async ({ page, runtime }, info) => {
  const c = await seed(runtime.member, 'demo-d');
  await start(page, runtime); await open(page, c.order.id);
  await page.getByRole('button', { name: 'Chủ shop xem xét', exact: true }).click();
  await page.getByLabel('Hướng xử lý do bạn chọn').selectOption('RETURN_THEN_REFUND');
  await page.getByLabel('Lý do quyết định (bắt buộc)', { exact: true }).fill('Stale browser intent');
  await page.getByRole('button', { name: 'Duyệt xử lý đơn này', exact: true }).click();
  const fresh = await runtime.member.evaluate(c.id);
  await waitForEvaluation(runtime.member, c.id, fresh.operationId);
  const conflict = page.waitForResponse(response => response.url() === `${runtime.owner.origin}/api/cases/${c.id}/owner-decision` && response.request().method() === 'POST');
  await confirm(page);
  const denied = await conflict;
  expect(denied.status()).toBe(409);
  expect((await denied.json()).error.code).toBe('STALE_VERSION');
  await expect(page.getByRole('alert')).toContainText('Chưa hoàn tất thao tác');
  expect((await runtime.owner.detail(c.id)).receipt).toBeNull();
  await page.getByRole('button', { name: 'Tải lại thông tin', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Duyệt xử lý đơn này', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Duyệt xử lý đơn này', exact: true }).click();
  await confirm(page);
  await expect(page.getByText('Biên nhận mô phỏng', { exact: true })).toBeVisible();
  const result = await runtime.owner.detail(c.id);
  await info.attach('ui-observation', { contentType: 'application/json', body: JSON.stringify({
    caseId: c.id, caseStatus: result.status, receiptId: result.receipt!.id, errorStatus: denied.status()
  }) });
});

test('UI-N03: loading, empty, error and paginated queues', { annotation: [{ type: 'matrix-id', description: 'UI-N03' }, { type: 'matrix-variant', description: 'queue' }] }, async ({ page, runtime }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/cases?*', async route => { await gate; await route.continue(); });
  await start(page, runtime);
  await expect(page.getByRole('heading', { name: 'Đang lấy thông tin cho bạn…' })).toBeVisible();
  release();
  await expect(page.locator('.empty-state')).toBeVisible();
  await page.unroute('**/api/cases?*');
  await page.route('**/api/cases?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'QA_UNAVAILABLE', message: 'Synthetic UI read failure', requestId: 'ui-probe' } }) }));
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Chưa hoàn tất thao tác');
  await page.unroute('**/api/cases?*');
  const caseIds: string[] = [];
  for (let i = 0; i < 51; i++) caseIds.push((await runtime.member.intake('demo-d', `Browser pagination ${i}`)).caseId);
  await page.getByRole('button', { name: 'Tải lại thông tin', exact: true }).click();
  await expect(page.locator('.case-row')).toHaveCount(50);
  await page.getByRole('button', { name: 'Xem thêm yêu cầu', exact: true }).click();
  await expect(page.locator('.case-row')).toHaveCount(51);
  const displayed = await page.locator('.case-row .row-open').evaluateAll(elements => elements.map(e => e.getAttribute('aria-label')!.replace('Mở yêu cầu ', '')));
  expect(displayed.sort()).toEqual(caseIds.sort());
  await expect(page.getByRole('button', { name: 'Xem thêm yêu cầu', exact: true })).toHaveCount(0);
});

test('SEC-N01: proof references render as text without browser or server fetch', { annotation: { type: 'matrix-id', description: 'SEC-N01' } }, async ({ page, runtime }, info) => {
  const paths: string[] = [];
  const sentinel = createServer((req, res) => { paths.push(req.url ?? ''); res.end('QA sentinel'); });
  sentinel.listen(0, '127.0.0.1'); await once(sentinel, 'listening');
  try {
    const origin = `http://127.0.0.1:${(sentinel.address() as AddressInfo).port}`;
    await (await fetch(`${origin}/control`)).text();
    const network: string[] = [];
    page.on('request', request => { if (request.url().startsWith(origin)) network.push(request.url()); });
    const c = await seed(runtime.member, 'demo-b');
    await start(page, runtime); await open(page, c.order.id);
    const reference = `<img src="${origin}/proof" onerror="globalThis.__qaReferenceExecuted=1">`;
    await addProof(page, c, reference);
    await addProof(page, c, `${origin}/plain-url-proof`);
    await expect(page.locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => (globalThis as typeof globalThis & { __qaReferenceExecuted?: number }).__qaReferenceExecuted)).toBeUndefined();
    await page.getByRole('button', { name: 'Chủ shop xem xét', exact: true }).click();
    await expect(page.getByText(reference, { exact: true })).toBeVisible();
    await expect(page.getByText(`${origin}/plain-url-proof`, { exact: true })).toBeVisible();
    await page.reload(); await open(page, c.order.id);
    await expect(page.getByText(reference, { exact: true })).toBeVisible();
    await expect(page.getByText(`${origin}/plain-url-proof`, { exact: true })).toBeVisible();
    await expect(page.locator(`a[href^="${origin}"]`)).toHaveCount(0);
    expect(paths).toEqual(['/control']);
    expect(network).toHaveLength(0);
    expect((await runtime.member.detail(c.id)).receipt).toBeNull();
    expect((await runtime.member.detail(c.id)).evidence.map(e => e.reviewStatus)).toEqual(['SUBMITTED', 'SUBMITTED']);
    expect((await runtime.localD1!.inspect(c.id)).evaluationCount).toBe(1);
    await info.attach('proof-reference-probe', { contentType: 'application/json', body: JSON.stringify({
      controlRequests: 1, referenceRequests: 0, submittedReferences: 2,
      observationScope: 'Real browser component/API/D1 submit, review display and refresh, with reachable sentinel'
    }) });
  } finally { await new Promise<void>((resolve, reject) => sentinel.close(error => error ? reject(error) : resolve())); }
});
