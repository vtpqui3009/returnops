import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import { Readable } from 'node:stream';

const runs = new Map();

// Only provider output is substituted. Routing, policy, SQL and receipts come from the backend.
async function testAgent() {
  return {
    executionMode: 'TEST', model: 'local-test-double', providerResponseId: `test-${randomUUID()}`,
    reply: 'SIMULATED: synthetic TEST reply', toolFacts: []
  };
}

function sessions() {
  const member = `returnops_qa=${randomBytes(32).toString('hex')}`;
  const owner = `returnops_qa=${randomBytes(32).toString('hex')}`;
  return {
    roles: new Map([[member, 'qa-member'], [owner, 'qa-owner']]),
    headers: { MEMBER: { Cookie: member }, OWNER: { Cookie: owner } }
  };
}

function localIngress(origin, roles, dispatch) {
  return createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, origin);
      if (incoming.headers.host !== url.host || url.origin !== origin || !url.pathname.startsWith('/api/')) {
        outgoing.writeHead(404).end();
        return;
      }
      if (Object.keys(incoming.headers).some(name => name.startsWith('oai-authenticated-user-'))) {
        outgoing.writeHead(400).end();
        return;
      }
      const headers = new Headers();
      for (const name of ['origin', 'content-type', 'idempotency-key']) {
        if (typeof incoming.headers[name] === 'string') headers.set(name, incoming.headers[name]);
      }
      const actor = roles.get(incoming.headers.cookie);
      if (actor) {
        headers.set('oai-authenticated-user-id', actor);
        headers.set('oai-authenticated-user-email', `${actor}@example.test`);
      }
      const body = ['GET', 'HEAD'].includes(incoming.method) ? undefined : Readable.toWeb(incoming);
      const result = await dispatch(new Request(url, { method: incoming.method, headers, body, duplex: 'half' }));
      outgoing.writeHead(result.status, Object.fromEntries(result.headers));
      outgoing.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      outgoing.writeHead(500).end('Local integration bridge failed');
    }
  });
}

export default {
  async prepare({ baseURL }) {
    const target = new URL(baseURL);
    if (target.origin !== baseURL || target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || Number(target.port) < 1024) {
      throw new Error('Local TEST adapter requires http://127.0.0.1:<unused port above 1023>.');
    }
    if (process.env.RETURNOPS_TEST_ALLOW_MUTATIONS !== '1' || (process.env.RETURNOPS_TEST_EXECUTION_MODE ?? 'TEST') !== 'TEST') {
      throw new Error('Local TEST adapter requires explicit mutation opt-in and TEST mode.');
    }
    const root = process.env.RETURNOPS_BACKEND_ROOT;
    if (!root || !isAbsolute(root)) throw new Error('Set RETURNOPS_BACKEND_ROOT to the absolute path of the trusted backend checkout.');
    const entrypoint = join(root, 'package.json');
    const fromBackend = createRequire(entrypoint);
    const { Miniflare } = fromBackend('miniflare');
    const loadTS = fromBackend('tsx/cjs/api').require;
    const { handleApi } = loadTS('./src/server/api.ts', entrypoint);
    const { seedDemo } = loadTS('./scripts/demo-data.ts', entrypoint);
    const migration = await readFile(join(root, 'drizzle', '0001_returnops.sql'), 'utf8');
    const fixtureRunId = `pr8-local-${randomUUID()}`;
    const miniflare = new Miniflare({
      modules: true, script: 'export default {fetch(){return new Response(null,{status:404})}}',
      host: '127.0.0.1', cf: false, d1Persist: false, d1Databases: { DB: fixtureRunId }
    });
    let server;
    const dispose = async () => {
      try {
        if (server?.listening) {
          // Stop accepting requests and drain any active handler before disposing D1.
          await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
      } finally { await miniflare.dispose(); }
    };
    try {
      const db = await miniflare.getD1Database('DB');
      // Same statement boundaries as PR #8's migration tests, including trigger bodies.
      for (const sql of migration.match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g) ?? []) await db.prepare(sql.trim()).run();
      await seedDemo(db);
      const { roles, headers } = sessions();
      const config = { SITES_IDENTITY_VERIFIED: 'true', OWNER_USER_IDS: 'qa-owner', MEMBER_USER_IDS: 'qa-member' };
      server = localIngress(target.origin, roles, request => handleApi(request, db, config, testAgent));
      const ready = once(server, 'listening');
      server.listen(Number(target.port), '127.0.0.1');
      await ready;
      runs.set(fixtureRunId, dispose);
      return { fixtureRunId, executionMode: 'TEST', headers };
    } catch (error) {
      await dispose();
      throw error;
    }
  },
  async cleanup({ fixtureRunId }) {
    const dispose = runs.get(fixtureRunId);
    runs.delete(fixtureRunId);
    if (dispose) await dispose();
  }
};
