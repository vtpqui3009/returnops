import { test } from '@playwright/test';
import { HOSTED_CASE_IDS, readCatalog } from '../support/catalog';

for (const c of readCatalog().filter(c => HOSTED_CASE_IDS.includes(c.id) || c.id === 'DATA-N01')) {
  test(c.id, { annotation: [
    { type: 'matrix-id', description: c.id },
    { type: 'blocker', description: c.id === 'DATA-N01'
      ? 'Application reset CLI and preservation of non-demo records remain unverified. Fixture restart/reset checks are partial probes.'
      : 'No designated hosted URL, approved role sessions or coordinator migration evidence is configured. Local tests have separate results.' }
  ] }, async () => {
    test.skip(true, 'NOT RUN: full requirement prerequisites are unavailable.');
  });
}
