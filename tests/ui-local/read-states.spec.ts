import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { waitForEvaluation } from '../support/api';

test.afterEach(async ({ page }) => { await page.close(); });

async function checkReadRecovery(page: Page, endpoint: string, navigation: Locator, recoveredContent: Locator) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(endpoint, async route => {
    await gate;
    await route.fulfill({ status: 503, json: { error: {
      code: 'QA_UNAVAILABLE', message: 'Synthetic read failure', requestId: 'ui-read-probe'
    } } });
  }, { times: 1 });

  try {
    const request = page.waitForRequest(endpoint);
    await navigation.click();
    expect((await request).method()).toBe('GET');
    await expect(page.getByRole('heading', { name: 'Đang lấy thông tin cho bạn…', exact: true })).toBeVisible();
  } finally { release(); }

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Chưa hoàn tất thao tác');
  const retry = page.waitForResponse(endpoint);
  await alert.getByRole('button', { name: 'Tải lại thông tin', exact: true }).click();
  expect((await retry).status()).toBe(200);
  await expect(recoveredContent).toBeVisible();
  await expect(alert).toHaveCount(0);
}

for (const screen of ['Learning', 'Case detail', 'Owner review'] as const) {
  test(`UI-N03: ${screen} handles loading, failed read and recovery`,
    { annotation: { type: 'matrix-id', description: 'UI-N03' } },
    async ({ page, runtime }) => {
      const origin = runtime.owner.origin;
      const cookie = runtime.headers.OWNER.Cookie;
      const separator = cookie.indexOf('=');
      await page.context().addCookies([{ url: origin, name: cookie.slice(0, separator), value: cookie.slice(separator + 1) }]);
      const claim = 'Read-state probe for owner review';
      const detail = screen === 'Learning' ? null : await runtime.member.intake('demo-d', claim);
      if (detail) await waitForEvaluation(runtime.member, detail.caseId, detail.evaluationOperationId);

      await page.goto(origin);
      if (!detail) {
        await expect(page.getByRole('heading', { name: 'Chưa có yêu cầu phù hợp' })).toBeVisible();
        await checkReadRecovery(page, `${origin}/api/rule-suggestions`,
          page.getByRole('button', { name: 'Quy tắc của shop', exact: true }),
          page.getByRole('heading', { name: 'Chưa có gợi ý quy tắc mới', exact: true }));
        return;
      }

      const openCase = page.getByRole('button', { name: claim, exact: true });
      await expect(openCase).toBeVisible();
      const endpoint = `${origin}/api/cases/${detail.caseId}`;
      if (screen === 'Case detail') {
        await checkReadRecovery(page, endpoint, openCase, page.getByRole('heading', { name: claim, exact: true }));
      } else {
        await openCase.click();
        await expect(page.getByRole('heading', { name: claim, exact: true })).toBeVisible();
        await checkReadRecovery(page, endpoint, page.getByRole('button', { name: 'Chủ shop xem xét', exact: true }),
          page.getByLabel('Hướng xử lý do bạn chọn', { exact: true }));
      }
    });
}
