import { test } from '@playwright/test';
import { E2E_CASE_IDS, readCatalog } from '../support/catalog';

for (const c of readCatalog().filter(c => E2E_CASE_IDS.includes(c.id))) {
  test(c.id, { annotation: [
    { type: 'matrix-id', description: c.id },
    { type: 'blocker', description: 'Vinext/Sites route integration is not configured. The ui-local component checks have separate source SHAs and results.' }
  ] }, async () => {
    test.fixme(true, 'NOT RUN: no UI driver yet; API checks cannot substitute for E2E acceptance.');
  });
}
