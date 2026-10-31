import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bundle the existing UI component for an isolated browser/API check. App routes
// and deployment still require their own verification.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const output = join(root, 'tests', 'artifacts', 'ui-bundle');
const source = join(output, 'source');
const ref = process.env.RETURNOPS_UI_REF ?? 'origin/feat/qui-ui';
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const commit = git(['rev-parse', '--verify', ref]).trim();
await mkdir(source, { recursive: true });
for (const name of ['api.ts', 'presentation.ts', 'returnops-app.tsx', 'returnops.css', 'test-adapter.ts']) {
  await writeFile(join(source, name), git(['show', `${commit}:src/features/returnops/${name}`]));
}
await writeFile(join(output, 'entry.tsx'), `import { createRoot } from 'react-dom/client';
import App from './source/returnops-app';
createRoot(document.getElementById('root')!).render(<App testMode={false} />);
`);
const backend = process.env.RETURNOPS_BACKEND_ROOT;
if (!backend) throw new Error('A trusted backend checkout is required.');
const requireBackend = createRequire(join(backend, 'package.json'));
await requireBackend('esbuild').build({
  entryPoints: [join(output, 'entry.tsx')], bundle: true, outfile: join(output, 'app.js'),
  platform: 'browser', format: 'esm', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }
});
await writeFile(join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
await writeFile(join(output, 'source.json'), JSON.stringify({ uiCommit: commit, scope: 'Existing UI component in API mode, local dispatcher and D1, synthetic sessions and TEST agent' }, null, 2));
console.log(`UI component bundle ready at ${commit}.`);
