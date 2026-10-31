import type { Page, TestInfo } from '@playwright/test';
import type { CaseDetail } from '../../src/shared/contracts';
import { waitForEvaluation, type ApiClient } from '../support/api';
import { test, expect } from '../support/fixtures';
import type { PreparedScenario } from '../support/types';

test.afterEach(async ({ page }) => { await page.close(); });

async function start(page: Page, runtime: PreparedScenario & { owner: ApiClient }) {
  const cookie = runtime.headers.OWNER.Cookie;
  const separator = cookie.indexOf('=');
  await page.context().addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: runtime.owner.origin }]);
  await page.goto(runtime.owner.origin);
}

const claim = (order: string) => `Browser storage check ${order}`;
async function seed(member: ApiClient, order: string) {
  const intake = await member.intake(order, claim(order));
  return waitForEvaluation(member, intake.caseId, intake.evaluationOperationId);
}
async function openCase(page: Page, order: string) {
  await page.locator('.case-row').getByRole('button', { name: claim(order), exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(claim(order));
}
async function confirm(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function record(info: TestInfo, phase: string, c: CaseDetail, counts: Record<string, number>) {
  await info.attach('storage-retry-probe', { contentType: 'application/json', body: JSON.stringify({
    phase, caseId: c.id, caseVersion: c.caseVersion, receiptId: c.receipt?.id, auditEventCount: c.timeline.length, ...counts
  }) });
}

test('DATA-N01 local portion: persist a receipt and reset only the disposable fixture', {
  annotation: { type: 'related-matrix-id', description: 'DATA-N01' }
}, async ({ page, runtime }, info) => {
  const { member, localD1 } = runtime;
  test.skip(!localD1, 'Requires disposable D1 with persistence and reset controls.');
  const initial = await seed(member, 'demo-a');
  expect(initial.receipt?.id).toBeTruthy();
  await start(page, runtime);
  await openCase(page, initial.order.id);
  await expect(page.getByText(initial.receipt!.id, { exact: false })).toBeVisible();
  const once = await localD1!.inspect(initial.id);
  expect(once.receiptCount).toBe(1);
  await record(info, 'receipt visible before restart', initial, { ...once });

  await localD1!.restartStore();
  await page.reload();
  await openCase(page, initial.order.id);
  await expect(page.getByText(initial.receipt!.id, { exact: false })).toBeVisible();
  expect(await member.detail(initial.id)).toEqual(initial);
  expect(await localD1!.inspect(initial.id)).toEqual(once);
  await record(info, 'receipt visible after restart', initial, { ...once });

  await localD1!.resetStore();
  await page.reload();
  await expect(page.locator('.empty-state')).toBeVisible();
  await expect(page.locator('.case-row')).toHaveCount(0);
  const fresh = await seed(member, 'demo-a');
  expect(fresh.id).not.toBe(initial.id);
  expect(fresh.receipt?.id).toBeTruthy();
  expect(fresh.receipt!.id).not.toBe(initial.receipt!.id);
  await page.reload();
  await openCase(page, fresh.order.id);
  await expect(page.getByText(fresh.receipt!.id, { exact: false })).toBeVisible();
  const reseeded = await localD1!.inspect(fresh.id);
  expect(reseeded.receiptCount).toBe(1);
  await record(info, 'fresh receipt after empty queue', fresh, { ...reseeded, queueSize: 0 });
});

test('R-N04: retry a committed browser decision after losing its response', {
  annotation: { type: 'matrix-id', description: 'R-N04' }
}, async ({ page, runtime }, info) => {
  const { member, localD1 } = runtime;
  test.skip(!localD1, 'Requires a post-commit transport fault.');
  const c = await seed(member, 'demo-d');
  await start(page, runtime);
  await openCase(page, c.order.id);
  const attempts: { key?: string; body: string | null }[] = [];
  let upstreamLost = false;
  await page.route(`**/api/cases/${c.id}/owner-decision`, async route => {
    const request = route.request();
    attempts.push({ key: request.headers()['idempotency-key'], body: request.postData() });
    if (attempts.length > 1) {
      await route.continue();
      return;
    }
    // A warm Chromium connection can transparently replay a dropped socket.
    // Forward the real mutation once, then propagate its loss to the browser.
    try {
      const response = await route.fetch({ maxRetries: 0 });
      await route.fulfill({ response });
    } catch {
      upstreamLost = true;
      await route.abort('connectionreset');
    }
  });
  await page.getByRole('button', { name: 'Owner review', exact: true }).click();
  await page.getByRole('combobox', { name: 'Your selected resolution' }).click();
  await page.getByRole('option', { name: 'Return, then refund', exact: true }).click();
  await page.getByLabel('Decision reason (required)', { exact: true }).fill('Synthetic response-loss test');
  await page.getByRole('button', { name: 'Approve this resolution', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  localD1!.dropNextCommittedResponse();
  await confirm(page);
  await expect(page.getByRole('alert')).toContainText('Action incomplete');
  expect(upstreamLost).toBe(true);
  await expect(page.getByText('Simulated receipt', { exact: true })).toHaveCount(0);
  const committed = await member.detail(c.id);
  const once = await localD1!.inspect(c.id);
  expect(committed.status).toBe('COMPLETED');
  expect(committed.receipt?.id).toBeTruthy();
  expect(once.receiptCount).toBe(1);
  await record(info, 'browser saw error after D1 committed', committed, { ...once });

  await page.getByRole('button', { name: 'Retry confirmed action', exact: true }).click();
  await confirm(page);
  await expect(page.getByText('Simulated receipt', { exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[0].key).toBeTruthy();
  expect(attempts[0].body).toBeTruthy();
  expect(attempts[0]).toEqual(attempts[1]);
  expect(await member.detail(c.id)).toEqual(committed);
  expect(await localD1!.inspect(c.id)).toEqual(once);
  await page.reload();
  await openCase(page, c.order.id);
  await expect(page.getByText(committed.receipt!.id, { exact: false })).toBeVisible();
  await record(info, 'same browser intent recovered original receipt', committed, { ...once });
});
