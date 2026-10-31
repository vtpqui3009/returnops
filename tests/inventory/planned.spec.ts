import { test } from '@playwright/test';
import { HOSTED_CASE_IDS, readCatalog } from '../support/catalog';

for (const c of readCatalog().filter(c => HOSTED_CASE_IDS.includes(c.id))) {
  test(c.id, { annotation: [
    { type: 'matrix-id', description: c.id },
    { type: 'blocker', description: 'No designated hosted URL, approved role sessions or coordinator migration evidence is configured. Local tests have separate results.' }
  ] }, async () => {
    test.skip(true, 'NOT RUN: hosted prerequisites are unavailable.');
  });
}
