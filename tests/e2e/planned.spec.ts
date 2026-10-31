import { test } from '@playwright/test';
import { E2E_CASE_IDS, readCatalog } from '../support/catalog';

for (const c of readCatalog().filter(c => E2E_CASE_IDS.includes(c.id))) {
  test(c.id, { annotation: [
    { type: 'matrix-id', description: c.id },
    { type: 'blocker', description: 'Product UI routes/selectors and browser scenario drivers are not available.' }
  ] }, async () => {
    test.fixme(true, 'NOT RUN: no UI driver yet; API checks cannot substitute for E2E acceptance.');
  });
}
