import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const layer = process.argv[2];
const blockers = [];
let url;
try {
  url = new URL(process.env.RETURNOPS_TEST_BASE_URL ?? '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
} catch { blockers.push('Set RETURNOPS_TEST_BASE_URL to the test app origin (no credentials, path or query).'); }
if (url && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && process.env.RETURNOPS_TEST_ALLOW_REMOTE !== '1') {
  blockers.push('Remote execution requires RETURNOPS_TEST_ALLOW_REMOTE=1 for an explicitly designated test deployment.');
}
if (process.env.RETURNOPS_TEST_ALLOW_MUTATIONS !== '1') blockers.push('Set RETURNOPS_TEST_ALLOW_MUTATIONS=1 only for a disposable synthetic-data environment.');
if (!['LIVE', 'TEST', 'REPLAY'].includes(process.env.RETURNOPS_TEST_EXECUTION_MODE ?? 'TEST')) blockers.push('RETURNOPS_TEST_EXECUTION_MODE must be TEST, REPLAY or LIVE.');
const adapter = process.env.RETURNOPS_TEST_ADAPTER;
if (!adapter || !existsSync(resolve(adapter))) blockers.push('Set RETURNOPS_TEST_ADAPTER to the real seed/reset/identity adapter module; see adapters/README.md.');
if (layer === 'e2e') blockers.push('UI selectors and scenario drivers are not implemented yet; e2e cases are explicitly planned/NOT RUN.');
if (!['api', 'e2e'].includes(layer)) blockers.push('Expected api or e2e.');
if (blockers.length) {
  console.error(`NOT RUN (${layer}):\n- ${blockers.join('\n- ')}`);
  process.exitCode = 2;
}
