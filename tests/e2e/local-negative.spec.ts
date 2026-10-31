import { expect, test as base, type Page } from '@playwright/test';
import { ApiClient, validateOrigin, waitForEvaluation } from '../support/api';
import type { CaseDetail } from '../../src/shared/contracts';

type OwnerRuntime = { owner: ApiClient; cookie: string };

const test = base.extend<{ ownerRuntime: OwnerRuntime }>({
  ownerRuntime: async ({}, provide) => {
    const origin = validateOrigin(
      process.env['RETURNOPS_TEST_' + 'BASE_URL'] ?? '',
      process.env['RETURNOPS_TEST_' + 'ALLOW_REMOTE'] === '1',
    );
    const signIn = await fetch(`${origin}/signin-with-chatgpt`, {
      redirect: 'manual',
    });
    const cookie = signIn.headers.get('set-cookie')?.split(';')[0];
    if (signIn.status !== 302 || !cookie) {
      throw new Error('NOT RUN: local owner profile is unavailable.');
    }
    await provide({
      cookie,
      owner: new ApiClient(origin, { Cookie: cookie }, false, 45_000),
    });
  },
});

async function signIn(page: Page, runtime: OwnerRuntime) {
  const separator = runtime.cookie.indexOf('=');
  await page.context().addCookies([
    {
      url: runtime.owner.origin,
      name: runtime.cookie.slice(0, separator),
      value: runtime.cookie.slice(separator + 1),
    },
  ]);
  await page.goto(runtime.owner.origin);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Mỗi yêu cầu',
  );
}

async function liveBCase(runtime: OwnerRuntime, claim: string) {
  const acknowledgement = await runtime.owner.intake('demo-b', claim);
  return waitForEvaluation(
    runtime.owner,
    acknowledgement.caseId,
    acknowledgement.evaluationOperationId,
  );
}

async function openCase(page: Page, detail: CaseDetail, claim: string) {
  await page.getByRole('button', { name: claim, exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: claim }),
  ).toBeVisible();
}

async function addEvidence(
  page: Page,
  detail: CaseDetail,
  reference: string,
  tracking = detail.order.tracking,
) {
  await page
    .getByLabel('Thông tin tham chiếu (bắt buộc)', { exact: true })
    .fill(reference);
  await page
    .getByLabel('Mã vận đơn trên bằng chứng (bắt buộc)', { exact: true })
    .fill(tracking);
  await page.getByRole('button', { name: 'Thêm bằng chứng', exact: true }).click();
  await expect(page.getByText('Đã ghi nhận thao tác.', { exact: false })).toBeVisible({
    timeout: 10_000,
  });
}

test('B-01/B-02: waiting B displays its missing proof and keeps submitted evidence unverified', {
  annotation: [
    { type: 'matrix-id', description: 'B-01' },
  ],
}, async ({ page, ownerRuntime }) => {
  const claim = 'Full-route negative B waiting and submitted proof';
  const detail = await liveBCase(ownerRuntime, claim);
  expect(detail.status).toBe('WAITING_EVIDENCE');
  expect(detail.missingEvidence).toContain('SELLER_PACKING_PROOF');
  expect(detail.receipt).toBeNull();

  await signIn(page, ownerRuntime);
  await openCase(page, detail, claim);
  await expect(page.getByText('Chờ bằng chứng', { exact: true })).toBeVisible();
  await addEvidence(
    page,
    detail,
    'Synthetic current seller packing reference remains unverified',
  );
  await expect(page.getByText('Chờ đối chiếu', { exact: true })).toBeVisible();
  await expect(page.getByText('Biên nhận mô phỏng', { exact: true })).toBeHidden();

  const after = await ownerRuntime.owner.detail(detail.id);
  expect(after.status).toBe('WAITING_EVIDENCE');
  expect(after.receipt).toBeNull();
  expect(after.evidence.at(-1)).toMatchObject({ reviewStatus: 'SUBMITTED' });
});

test('B-N01/B-N03: wrong or stale proof cannot become a current verified proof', {
  annotation: [
    { type: 'matrix-id', description: 'B-N01' },
  ],
}, async ({ page, ownerRuntime }) => {
  const claim = 'Full-route negative B wrong and stale proof';
  const detail = await liveBCase(ownerRuntime, claim);

  await signIn(page, ownerRuntime);
  await openCase(page, detail, claim);
  await addEvidence(page, detail, 'Synthetic wrong tracking reference', 'wrong-tracking');
  await expect(page.getByRole('button', { name: 'Xác minh bằng chứng', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Từ chối', exact: true })).toBeDisabled();

  const beforeStale = await ownerRuntime.owner.detail(detail.id);
  const wrongProof = beforeStale.evidence.find(
    (evidence) => evidence.reference === 'Synthetic wrong tracking reference',
  );
  expect(wrongProof).toBeDefined();
  const wrongReview = await ownerRuntime.owner.request<{
    error: { code: string };
  }>(
    'POST',
    `/api/cases/${encodeURIComponent(detail.id)}/evidence/${encodeURIComponent(wrongProof!.id)}/review`,
    [409],
    {
      expectedCaseVersion: beforeStale.caseVersion,
      expectedEvidenceVersion: wrongProof!.evidenceVersion,
      reviewStatus: 'VERIFIED',
      reason: 'Synthetic attempt to verify wrong tracking',
    },
  );
  expect(wrongReview.body.error.code).toBe('PROOF_CONTEXT_MISMATCH');

  const staleSubmission = await ownerRuntime.owner.request<{
    evidenceId: string;
  }>(
    'POST',
    `/api/cases/${encodeURIComponent(detail.id)}/evidence`,
    [201],
    {
      expectedCaseVersion: beforeStale.caseVersion,
      orderId: beforeStale.order.id,
      orderVersion: beforeStale.order.orderVersion + 1,
      tracking: beforeStale.order.tracking,
      type: 'PACKING',
      source: 'SELLER',
      reference: 'Synthetic stale order-version reference',
      observedAt: Math.floor(Date.now() / 1000),
    },
  );
  const afterStaleSubmission = await ownerRuntime.owner.detail(detail.id);
  const staleProof = afterStaleSubmission.evidence.find(
    (evidence) => evidence.id === staleSubmission.body.evidenceId,
  );
  expect(staleProof).toBeDefined();
  const staleReview = await ownerRuntime.owner.request<{
    error: { code: string };
  }>(
    'POST',
    `/api/cases/${encodeURIComponent(detail.id)}/evidence/${encodeURIComponent(staleProof!.id)}/review`,
    [409],
    {
      expectedCaseVersion: afterStaleSubmission.caseVersion,
      expectedEvidenceVersion: staleProof!.evidenceVersion,
      reviewStatus: 'VERIFIED',
      reason: 'Synthetic attempt to verify stale order version',
    },
  );
  expect(staleReview.body.error.code).toBe('PROOF_CONTEXT_MISMATCH');
  await page.reload();
  await openCase(page, afterStaleSubmission, claim);
  const verifyButtons = page.getByRole('button', {
    name: 'Xác minh bằng chứng',
    exact: true,
  });
  await expect(verifyButtons).toHaveCount(2);
  await expect(verifyButtons.nth(0)).toBeDisabled();
  await expect(verifyButtons.nth(1)).toBeDisabled();

  const after = await ownerRuntime.owner.detail(detail.id);
  expect(after.status).toBe('WAITING_EVIDENCE');
  expect(after.receipt).toBeNull();
  expect(after.evidence).toHaveLength(beforeStale.evidence.length + 1);
});

test('B-N04: rejected proof stays immutable and replacement is a separate submitted record', {
  annotation: { type: 'matrix-id', description: 'B-N04' },
}, async ({ page, ownerRuntime }) => {
  const claim = 'Full-route rejected proof replacement';
  const detail = await liveBCase(ownerRuntime, claim);
  const rejectedReference = 'Synthetic rejected seller packing reference';
  const replacementReference = 'Synthetic replacement seller packing reference';

  await signIn(page, ownerRuntime);
  await openCase(page, detail, claim);
  await addEvidence(page, detail, rejectedReference);
  await page.getByRole('button', { name: 'Chủ shop xem xét', exact: true }).click();
  await page
    .getByLabel('Kết quả đối chiếu (bắt buộc)', { exact: true })
    .fill('Synthetic rejection: source record does not match.');
  await page.getByRole('button', { name: 'Từ chối', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Xác nhận', exact: true })
    .click();
  await expect(page.getByText('Đã từ chối', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(rejectedReference, { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Thêm tham chiếu thay thế', exact: true })
    .click();
  await addEvidence(page, detail, replacementReference);

  const after = await ownerRuntime.owner.detail(detail.id);
  const rejected = after.evidence.find(
    (evidence) => evidence.reference === rejectedReference,
  );
  const replacement = after.evidence.find(
    (evidence) => evidence.reference === replacementReference,
  );
  expect(rejected).toMatchObject({ reviewStatus: 'REJECTED' });
  expect(replacement).toMatchObject({ reviewStatus: 'SUBMITTED' });
  expect(replacement?.id).not.toBe(rejected?.id);
  expect(after.status).toBe('WAITING_EVIDENCE');
  expect(after.receipt).toBeNull();
});
