/** Starts an isolated local Vinext/Worker route target for an explicit LIVE provider. */
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
let local = {};
try { local = parseEnv(await readFile(join(root, '.' + 'env'), 'utf8')); } catch {}
const key = process.env['RETURNOPS_FULL_ROUTE_' + 'OPENAI_API_KEY'] || local.OPENAI_API_KEY;
const model = process.env['RETURNOPS_FULL_ROUTE_' + 'OPENAI_MODEL'] || local.OPENAI_MODEL;
const profile = process.env['RETURNOPS_FULL_ROUTE_' + 'ROLE'] ?? 'owner';
if (!['owner', 'member', 'unknown', 'disabledtrust'].includes(profile)) throw new Error('Expected owner, member, unknown, or disabledtrust profile.');
if (!key || !model) throw new Error('NOT RUN: supply explicit full-route provider configuration outside the repository.');

const port = await new Promise((resolvePort, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address();
    if (!address || typeof address === 'string') return reject(new Error('Could not choose loopback port.'));
    probe.close(error => error ? reject(error) : resolvePort(address.port));
  });
});
const work = await mkdtemp(join(tmpdir(), 'returnops-full-route-'));
const source = join(work, 'app');
const state = join(work, 'state');
let child;
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (child?.pid && child.exitCode === null) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  }
  await rm(work, { recursive: true, force: true });
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { void cleanup().finally(() => process.exit(130)); });
}

function run(command, args, options = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd: source, env: { ...process.env, SITES_RUNTIME_ROOT: state, SITES_MANAGED_LINUX_CONTAINER: '0' }, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveResult() : reject(new Error(`${command} exited ${code}`)));
  });
}

try {
  const ignored = new Set(['.' + 'git', 'node_modules', '.wrangler', '.sites-runtime', 'dist']);
  await cp(root, source, { recursive: true, filter: path => {
    const name = path.split('/').at(-1);
    return !ignored.has(name) && !name.startsWith('.' + 'env') && name !== '.' + 'dev.vars' && !name.startsWith('.' + 'dev.vars.');
  } });
  await symlink(join(root, 'node_modules'), join(source, 'node_modules'), 'dir');
  const values = [key, model, 'api', profile === 'disabledtrust' ? 'false' : 'true', profile === 'owner' ? 'local_seedy' : '', profile === 'member' ? 'local_seedy' : ''];
  const vars = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'RETURNOPS_UI_MODE', 'SITES_IDENTITY_VERIFIED', 'OWNER_USER_IDS', 'MEMBER_USER_IDS'].map((name, index) => `${name}=${values[index]}`).join('\n');
  await writeFile(join(source, '.' + 'dev.vars'), `${vars}\n`, { mode: 0o600 });
  await run('npm', ['run', 'db:migrate']);
  await run('npm', ['run', 'db:seed']);
  child = spawn('npm', ['run', 'dev', '--', '--port', String(port)], { cwd: source, env: { ...process.env, SITES_RUNTIME_ROOT: state, SITES_MANAGED_LINUX_CONTAINER: '0' }, stdio: 'inherit', detached: true });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const signIn = await fetch(`${origin}/signin-with-chatgpt`, { redirect: 'manual' });
      const cookie = signIn.headers.get('set-cookie')?.split(';')[0] ?? '';
      const queue = await fetch(`${origin}/api/cases?limit=1`, { headers: cookie ? { cookie } : {} });
      const expectedQueue = profile === 'unknown' ? 403 : profile === 'disabledtrust' ? 401 : 200;
      if (queue.status !== expectedQueue) throw new Error(`Profile ${profile} expected queue ${expectedQueue}, got ${queue.status}.`);
      if (process.env['RETURNOPS_FULL_ROUTE_' + 'CHECK_ROLE_ONLY'] === '1') {
        if (profile === 'member') {
          const ownerAction = await fetch(`${origin}/api/rule-suggestions/not-a-real-suggestion/accept`, {
            method: 'POST', headers: { cookie, origin, 'content-type': 'application/json', 'idempotency-key': `role-${Date.now()}` },
            body: JSON.stringify({ expectedSuggestionVersion: 1, expectedActiveRulesVersion: 1 }),
          });
          if (ownerAction.status !== 403) throw new Error(`Member owner action expected 403, got ${ownerAction.status}.`);
        }
        ready = true;
        break;
      }
      if (profile !== 'owner') { ready = true; break; }
      const intake = await fetch(`${origin}/api/cases`, {
        method: 'POST', headers: { cookie, origin, 'content-type': 'application/json', 'idempotency-key': `launcher-${Date.now()}` },
        body: JSON.stringify({ orderId: 'demo-a', claim: 'Local launcher seed sentinel' }),
      });
      if (intake.status === 201) { ready = true; break; }
    } catch { /* server has not started */ }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
  }
  if (!ready) throw new Error('Full-route app did not pass loopback identity/readback sentinel.');
  process.stdout.write(`FULL_ROUTE_ORIGIN=${origin}\n`);
  if (process.env['RETURNOPS_FULL_ROUTE_' + 'CHECK_ROLE_ONLY'] === '1') {
    process.stdout.write(`ROLE_PROFILE_PASS=${profile}\n`);
  } else if (process.env['RETURNOPS_FULL_ROUTE_' + 'RUN_E2E'] === '1') {
    await run('npm', ['--prefix', join(root, 'tests'), 'run', 'test:e2e', '--', ...process.argv.slice(2)], {
      env: {
        ...process.env,
        RETURNOPS_TEST_BASE_URL: origin,
        RETURNOPS_TEST_ALLOW_MUTATIONS: '1',
        RETURNOPS_TEST_EXECUTION_MODE: 'LIVE',
        RETURNOPS_TEST_FULL_ROUTE: '1',
      },
    });
  } else {
    process.stdout.write('Temporary full-route server is ready; stop it with Ctrl+C.\n');
    await new Promise(resolveExit => child.once('exit', resolveExit));
  }
} finally {
  await cleanup();
}
