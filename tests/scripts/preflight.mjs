import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const layer = process.argv[2];
const blockers = [];
const env = name => process.env[name];
let url;
try {
  url = new URL(env(['RETURNOPS_TEST_', 'BASE_URL'].join('')) ?? '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
} catch { blockers.push('Set a test app origin without credentials, path, or query.'); }
if (url && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && env(['RETURNOPS_TEST_', 'ALLOW_REMOTE'].join('')) !== '1') blockers.push('Remote execution needs explicit designated-target opt-in.');
if (env(['RETURNOPS_TEST_', 'ALLOW_MUTATIONS'].join('')) !== '1') blockers.push('Set mutation opt-in only for a disposable synthetic-data environment.');
const mode = env(['RETURNOPS_TEST_', 'EXECUTION_MODE'].join('')) ?? 'TEST';
if (!['LIVE', 'TEST', 'REPLAY'].includes(mode)) blockers.push('Execution mode must be TEST, REPLAY, or LIVE.');
if (layer === 'e2e') {
  if (mode !== 'LIVE') blockers.push('Full-route E2E requires LIVE mode; TEST and REPLAY are separate evidence.');
  if (env(['RETURNOPS_TEST_', 'FULL_ROUTE'].join('')) !== '1') blockers.push('Set full-route opt-in only after the target uses Vinext and same-origin app/api routes.');
} else {
  const adapter = env(['RETURNOPS_TEST_', 'ADAPTER'].join(''));
  if (!adapter || !existsSync(resolve(adapter))) blockers.push('Set the real seed/reset/identity adapter module; see adapters/README.md.');
}
if (!['api', 'e2e', 'ui-local'].includes(layer)) blockers.push('Expected api, ui-local, or e2e.');
if (blockers.length) {
  console.error(`NOT RUN (${layer}):\n- ${blockers.join('\n- ')}`);
  process.exitCode = 2;
}
