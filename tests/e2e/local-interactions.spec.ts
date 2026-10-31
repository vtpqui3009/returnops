import { expect, test as base, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { ApiClient, validateOrigin, waitForEvaluation } from '../support/api';
import type { CaseDetail } from '../../src/shared/contracts';

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

async function signIn(page: Page, runtime: OwnerRuntime) {
  const separator = runtime.cookie.indexOf('=');
  await page.context().addCookies([{
    url: runtime.owner.origin,
    name: runtime.cookie.slice(0, separator),
    value: runtime.cookie.slice(separator + 1),
  }]);
  await page.goto(runtime.owner.origin);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('A clear resolution');
}

async function liveCase(runtime: OwnerRuntime, orderId: string, claim: string) {
  const ack = await runtime.owner.intake(orderId, claim);
  return waitForEvaluation(runtime.owner, ack.caseId, ack.evaluationOperationId);
}

async function openCase(page: Page, detail: CaseDetail, claim: string) {
  await page.getByRole('button', { name: claim, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: claim })).toBeVisible();
}

test('DATA-N01: metadata evidence remains text and does not request its reference', { annotation: { type: 'matrix-id', description: 'DATA-N01' } }, async ({ page, ownerRuntime }) => {
  const claim = 'Full-route metadata-only reference';
  const detail = await liveCase(ownerRuntime, 'demo-b', claim);
  const reference = 'https://untrusted.invalid/proof?token=synthetic';
  const externalRequests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).origin !== ownerRuntime.owner.origin) externalRequests.push(request.url());
  });
  await signIn(page, ownerRuntime);
  await openCase(page, detail, claim);
  await page.getByLabel('Reference details (required)', { exact: true }).fill(reference);
  await page.getByLabel('Evidence tracking number (required)', { exact: true }).fill(detail.order.tracking);
  await page.waitForTimeout(150);
  expect(externalRequests).toEqual([]);
  await page.getByRole('button', { name: 'Add evidence', exact: true }).click();
  await expect(page.getByText('Action recorded.', { exact: false })).toBeVisible({ timeout: 10_000 });
  const saved = await ownerRuntime.owner.detail(detail.id);
  expect(saved.evidence.some(evidence => evidence.reference === reference)).toBe(true);
  expect(externalRequests).toEqual([]);
});

test('UI-N01: mobile owner flow keeps a draft when Escape cancels confirmation', { annotation: { type: 'matrix-id', description: 'UI-N01' } }, async ({ page, ownerRuntime }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const claim = 'Full-route mobile keyboard cancel';
  const detail = await liveCase(ownerRuntime, 'demo-d', claim);
  await signIn(page, ownerRuntime);
  await openCase(page, detail, claim);
  await page.getByRole('button', { name: 'Owner review', exact: true }).click();
  await page.getByRole('combobox', { name: 'Your selected resolution' }).click();
  await page.getByRole('option', { name: 'Return, then refund', exact: true }).click();
  const reason = page.getByLabel('Decision reason (required)', { exact: true });
  await reason.fill('Synthetic mobile draft retained after cancellation');
  await page.getByRole('button', { name: 'Approve this resolution', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(reason).toHaveValue('Synthetic mobile draft retained after cancellation');
  await expect(page.getByRole('combobox', { name: 'Your selected resolution' })).toHaveText('Return, then refund');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await ownerRuntime.owner.detail(detail.id)).receipt).toBeNull();
});

test('R-N04: browser retries a committed owner decision after its response is lost', { annotation: { type: 'matrix-id', description: 'R-N04' } }, async ({ page, ownerRuntime }) => {
  const claim = 'Full-route lost owner-decision response';
  const detail = await liveCase(ownerRuntime, 'demo-d', claim);
  const endpoint = `${ownerRuntime.owner.origin}/api/cases/${detail.id}/owner-decision`;
  let dropped = false;
  await page.route(endpoint, async route => {
    if (!dropped && route.request().method() === 'POST') {
      dropped = true;
      await route.fetch();
      await route.abort('connectionreset');
      return;
    }
    await route.continue();
  });
  await signIn(page, ownerRuntime);
  await openCase(page, detail, claim);
  await page.getByRole('button', { name: 'Owner review', exact: true }).click();
  await page.getByRole('combobox', { name: 'Your selected resolution' }).click();
  await page.getByRole('option', { name: 'Return, then refund', exact: true }).click();
  const reason = page.getByLabel('Decision reason (required)', { exact: true });
  await reason.fill('Synthetic committed response-loss retry');
  await page.getByRole('button', { name: 'Approve this resolution', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry confirmed action', exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(reason).toHaveValue('Synthetic committed response-loss retry');
  const committed = await ownerRuntime.owner.detail(detail.id);
  expect(committed.receipt).not.toBeNull();
  await page.getByRole('button', { name: 'Retry confirmed action', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Simulated receipt', { exact: true })).toBeVisible({ timeout: 10_000 });
  const replayed = await ownerRuntime.owner.detail(detail.id);
  expect(replayed.receipt?.id).toBe(committed.receipt?.id);
});

test('UI-N03: real delayed queue, empty filter and reload keep the UI coherent', { annotation: { type: 'matrix-id', description: 'UI-N03' } }, async ({ page, ownerRuntime }) => {
  const claim = 'Full-route loading and empty filter';
  await liveCase(ownerRuntime, 'demo-b', claim);
  let releaseQueue: (() => void) | undefined;
  const queueHeld = new Promise<void>(resolve => { releaseQueue = resolve; });
  let intercepted = false;
  await page.route(`${ownerRuntime.owner.origin}/api/cases?limit=50`, async route => {
    if (intercepted) return route.continue();
    intercepted = true;
    await queueHeld;
    await route.continue();
  });
  const opening = signIn(page, ownerRuntime);
  await expect(page.getByText('Loading your information…', { exact: true })).toBeVisible({ timeout: 10_000 });
  releaseQueue?.();
  await opening;
  await expect(page.getByRole('button', { name: claim, exact: true })).toBeVisible();
  const search = page.locator('input[type=search]');
  await search.fill('no-such-synthetic-case');
  await expect(page.getByText('No matching requests', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: claim, exact: true })).toBeVisible();
});

test('SEC-N01: rendered HTML-like metadata and a controlled URL stay inert after reload', { annotation: { type: 'matrix-id', description: 'SEC-N01' } }, async ({ page, ownerRuntime }) => {
  let hits = 0;
  const server = createServer((_request, response) => {
    hits++;
    response.writeHead(204).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Controlled reference server did not bind.');
    const reference = `<img src=x onerror=alert(1)> http://127.0.0.1:${address.port}/reference`;
    const claim = 'Full-route inert metadata reference';
    const detail = await liveCase(ownerRuntime, 'demo-b', claim);
    const externalRequests: string[] = [];
    page.on('request', request => {
      if (new URL(request.url()).origin !== ownerRuntime.owner.origin) externalRequests.push(request.url());
    });
    await signIn(page, ownerRuntime);
    await openCase(page, detail, claim);
    await page.getByLabel('Reference details (required)', { exact: true }).fill(reference);
    await page.getByLabel('Evidence tracking number (required)', { exact: true }).fill(detail.order.tracking);
    await page.getByRole('button', { name: 'Add evidence', exact: true }).click();
    await expect(page.getByText(reference, { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.reload();
    await openCase(page, detail, claim);
    await expect(page.getByText(reference, { exact: true })).toBeVisible();
    expect(externalRequests).toEqual([]);
    expect(hits).toBe(0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
