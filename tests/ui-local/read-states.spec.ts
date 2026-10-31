import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { waitForEvaluation } from '../support/api';

test.afterEach(async ({ page }) => { await page.close(); });

async function checkReadRecovery(page: Page, endpoint: string, navigation: Locator, recoveredContent: Locator, info: TestInfo, screen: string) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(endpoint, async route => {
    await gate;
    await route.fulfill({ status: 503, json: { error: {
      code: 'QA_UNAVAILABLE', message: 'Synthetic read failure', requestId: 'ui-read-probe'
    } } });
  }, { times: 1 });

  const failedRead = page.waitForResponse(endpoint);
  try {
    const request = page.waitForRequest(endpoint);
    await navigation.click();
    expect((await request).method()).toBe('GET');
    await expect(page.getByRole('heading', { name: 'Loading your information…', exact: true })).toBeVisible();
  } finally { release(); }

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Action incomplete');
  const errorStatus = (await failedRead).status();
  expect(errorStatus).toBe(503);
  const retry = page.waitForResponse(endpoint);
  await alert.getByRole('button', { name: 'Reload information', exact: true }).click();
  const recoveryStatus = (await retry).status();
  expect(recoveryStatus).toBe(200);
  await expect(recoveredContent).toBeVisible();
  await expect(alert).toHaveCount(0);
  await info.attach('ui-observation', { contentType: 'application/json', body: JSON.stringify({
    screen, loadingObserved: true, errorStatus, recoveryStatus, recovered: true
  }) });
}

for (const screen of ['Learning', 'Case detail', 'Owner review'] as const) {
  test(`UI-N03: ${screen} handles loading, failed read and recovery`,
    { annotation: [{ type: 'matrix-id', description: 'UI-N03' }, { type: 'matrix-variant', description: screen.toLowerCase().replaceAll(' ', '-') }] },
    async ({ page, runtime }, info) => {
      const origin = runtime.owner.origin;
      const cookie = runtime.headers.OWNER.Cookie;
      const separator = cookie.indexOf('=');
      await page.context().addCookies([{ url: origin, name: cookie.slice(0, separator), value: cookie.slice(separator + 1) }]);
      const claim = 'Read-state probe for owner review';
      const detail = screen === 'Learning' ? null : await runtime.member.intake('demo-d', claim);
      if (detail) await waitForEvaluation(runtime.member, detail.caseId, detail.evaluationOperationId);

      await page.goto(origin);
      if (!detail) {
        await expect(page.getByRole('heading', { name: 'No matching requests' })).toBeVisible();
        await checkReadRecovery(page, `${origin}/api/rule-suggestions`,
          page.getByRole('button', { name: 'Shop rules', exact: true }),
          page.getByRole('heading', { name: 'No new rule suggestions', exact: true }), info, 'learning');
        return;
      }

      const openCase = page.getByRole('button', { name: claim, exact: true });
      await expect(openCase).toBeVisible();
      const endpoint = `${origin}/api/cases/${detail.caseId}`;
      if (screen === 'Case detail') {
        await checkReadRecovery(page, endpoint, openCase, page.getByRole('heading', { name: claim, exact: true }), info, 'case-detail');
      } else {
        await openCase.click();
        await expect(page.getByRole('heading', { name: claim, exact: true })).toBeVisible();
        await checkReadRecovery(page, endpoint, page.getByRole('button', { name: 'Owner review', exact: true }),
          page.getByLabel('Your selected resolution', { exact: true }), info, 'owner-review');
      }
    });
}
