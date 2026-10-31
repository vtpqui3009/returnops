/* eslint-disable @typescript-eslint/no-require-imports -- Optional Playwright contract regressions; no real backend. */
const { closeCheckedBrowser } = require('./browser-session.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const { recoveryFixture } = require('./recovery-fixture.cjs');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const results = [], errors = [];
  let fixture;
  page.on('pageerror', error => errors.push(error.message));
  const check = (name, pass) => { results.push({ name, pass }); if (!pass) throw Error(name); };
  await page.route('**/api/**', async route => {
    const request = route.request();
    const response = await fixture.fetcher(request.url(), { method: request.method(), headers: request.headers(), body: request.postData() });
    await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
  });
  const ready = () => page.waitForFunction(() => document.querySelector('main')?.getAttribute('aria-busy') === 'false');
  const open = async () => {
    await page.goto(process.env.UI_BASE_URL || 'http://127.0.0.1:5173'); await ready();
    await page.locator('.case-title').click(); await ready();
  };
  const confirm = async () => { await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click(); await ready(); };

  for (const action of ['evaluate', 'review']) {
    fixture = recoveryFixture({ action, pendingStatus: action === 'evaluate' ? 'PENDING' : 'RUNNING', failPollRead: true });
    await open();
    if (action === 'evaluate') await page.getByRole('button', { name: 'Đánh giá lại yêu cầu', exact: true }).click();
    else {
      await page.locator('#review-proof-1').fill('Đã đối chiếu bằng chứng đúng đơn');
      await page.getByRole('button', { name: 'Xác minh bằng chứng', exact: true }).click(); await confirm();
    }
    await ready();
    check(`${action}: acknowledged dispatch failure offers retry without false receipt`, await page.getByRole('button', { name: 'Thử lại thao tác đã xác nhận', exact: true }).isVisible() && await page.getByText('Biên nhận mô phỏng', { exact: true }).count() === 0);
    const durable = structuredClone(fixture.state);
    await fixture.fetcher(`/api/cases/${fixture.state.id}`);
    check(`${action}: independent GET does not advance pending work`, JSON.stringify(fixture.state) === JSON.stringify(durable));
    await page.getByRole('button', { name: 'Thử lại thao tác đã xác nhận', exact: true }).click(); await confirm();
    check(`${action}: retry replays exact POST intent`, fixture.posts.length === 2 && fixture.posts[0].key === fixture.posts[1].key && JSON.stringify(fixture.posts[0].body) === JSON.stringify(fixture.posts[1].body));
    check(`${action}: one operation and receipt after recovery`, fixture.counts.operationCount === 1 && fixture.counts.receiptCount === 1 && await page.getByText('Biên nhận mô phỏng', { exact: true }).count() === 1);
  }

  for (const status of ['NEEDS_OWNER_REVIEW', 'WAITING_EVIDENCE']) {
    fixture = recoveryFixture({ dispatchFailures: 0 });
    const c = fixture.state;
    c.status = status; c.pendingEvaluationOperationId = 'snapshot-failed';
    c.evaluation = { id: 'snapshot-failed', status: 'FAILED', executionMode: 'TEST', providerResponseId: null, model: null, error: { code: 'STALE_EVALUATION', message: 'Evidence changed' }, result: null };
    c.timeline.push({ id: 'failure-event', type: 'evaluation.failed', actorId: null, occurredAt: Math.floor(Date.now() / 1000), evaluationStatus: 'FAILED', executionMode: 'TEST', completionMode: null, details: { error: c.evaluation.error } });
    await open();
    check(`${status}: retained FAILED pointer allows explicit fresh evaluation`, await page.getByRole('button', { name: 'Đánh giá lại yêu cầu', exact: true }).isEnabled() && await page.getByRole('heading', { name: 'Đang đánh giá yêu cầu', exact: true }).count() === 0);
    check(`${status}: failure timeline uses warning icon and Vietnamese label`, await page.locator('.timeline-error .lucide-circle-alert').count() === 1 && await page.locator('.timeline-error .lucide-check').count() === 0 && await page.locator('.timeline-error strong').innerText() === 'Đánh giá chưa hoàn tất');
    if (status === 'NEEDS_OWNER_REVIEW') {
      await page.getByRole('button', { name: 'Xem xét yêu cầu', exact: true }).click(); await ready();
      check('Terminal failure does not lock owner completion controls', await page.getByRole('button', { name: 'Duyệt xử lý đơn này', exact: true }).isEnabled());
      await page.setViewportSize({ width: 375, height: 1000 });
      check('FAILED recovery layout fits mobile', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      fs.mkdirSync('output/ui-review', { recursive: true }); await page.screenshot({ path: 'output/ui-review/failed-mobile.png', fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    const expectedVersion = c.caseVersion;
    await page.getByRole('button', { name: 'Đánh giá lại yêu cầu', exact: true }).click(); await ready();
    check(`${status}: fresh evaluation uses current snapshot and distinct operation`, fixture.posts.length === 1 && fixture.posts[0].body.expectedCaseVersion === expectedVersion && c.evaluation.id !== 'snapshot-failed' && fixture.counts.receiptCount === 1);
  }

  fixture = recoveryFixture({ action: 'review', dispatchFailures: 0 });
  fixture.state.status = 'NEEDS_OWNER_REVIEW';
  const rejected = fixture.state.evidence[0];
  rejected.reviewStatus = 'REJECTED'; rejected.reviewReason = 'Tham chiếu cũ chưa đủ căn cứ'; rejected.source = 'CARRIER'; rejected.type = 'DELIVERY';
  await open();
  check('REJECTED record exposes no unsupported review actions', await page.locator('#review-proof-1').count() === 0 && await page.getByRole('button', { name: 'Xác minh bằng chứng', exact: true }).count() === 0 && await page.getByRole('button', { name: 'Từ chối', exact: true }).count() === 0);
  await page.getByRole('button', { name: 'Thêm tham chiếu thay thế', exact: true }).click();
  await page.locator('#ref-recovery-case').fill('Tham chiếu giao hàng thay thế');
  await page.locator('#tracking-recovery-case').fill('tracking-current');
  await page.getByRole('button', { name: 'Thêm bằng chứng', exact: true }).click(); await ready();
  check('Replacement is a separate metadata submission preserving source/type and rejected history', fixture.posts.length === 1 && fixture.posts[0].path.endsWith('/evidence') && fixture.posts[0].body.source === 'CARRIER' && fixture.posts[0].body.type === 'DELIVERY' && rejected.reviewStatus === 'REJECTED' && fixture.state.evidence.length === 2 && fixture.state.evidence[1].reviewStatus === 'SUBMITTED');
  check('Only replacement SUBMITTED record exposes review', await page.locator('#review-proof-1').count() === 0 && await page.locator('#review-proof-2').count() === 1 && await page.getByRole('button', { name: 'Xác minh bằng chứng', exact: true }).count() === 1);
  check('No browser runtime exceptions in independent recovery flows', errors.length === 0);
  fs.writeFileSync('docs/ui-evidence/recovery-results.json', JSON.stringify({ results, errors, fixture: 'Independent read-only GET / durable POST replay contract fixture; no real BE' }, null, 2));
  console.log(JSON.stringify({ passed: results.length, errors }));
  await closeCheckedBrowser(browser); process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
