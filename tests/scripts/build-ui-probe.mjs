import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bundle the existing UI component for an isolated browser/API check. App routes
// and deployment still require their own verification.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const output = join(root, 'tests', 'artifacts', 'ui-bundle');
const ref = process.env.RETURNOPS_UI_REF ?? 'origin/feat/qui-ui';
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const commit = git(['rev-parse', '--verify', ref]).trim();
const source = join(output, 'source', commit);
await mkdir(source, { recursive: true });
const prefix = 'src/features/returnops/';
const files = git(['ls-tree', '-r', '--name-only', commit, '--', prefix]).trim().split('\n')
  .filter(file => /\.(?:[cm]?[jt]sx?|css)$/.test(file));
if (!files.includes(prefix + 'returnops-app.tsx')) throw new Error('The selected UI revision has no ReturnOps component.');
for (const file of files) {
  const destination = join(source, file.slice(prefix.length));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, git(['show', `${commit}:${file}`]));
}
await writeFile(join(output, 'entry.tsx'), `import { createRoot } from 'react-dom/client';
import App from './source/${commit}/returnops-app';
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
