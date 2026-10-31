import { test } from '@playwright/test';
import { API_CASE_IDS, readCatalog } from '../support/catalog';

for (const c of readCatalog().filter(c => !API_CASE_IDS.includes(c.id))) {
  test(c.id, { annotation: [
    { type: 'matrix-id', description: c.id },
    { type: 'blocker', description: 'Planned assertion; needs runtime, fixture/fault hooks or remaining contract decisions.' }
  ] }, async () => {
    test.fixme(true, 'NOT RUN: assertion not implemented. This is inventory only.');
  });
}
