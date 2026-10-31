import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
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

function localIngress(origin, roles, dispatch, assets) {
  const active = new Set();
  const handle = async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, origin);
      if (incoming.headers.host !== url.host || url.origin !== origin) {
        outgoing.writeHead(404).end();
        return;
      }
      if (incoming.method === 'GET' && assets.has(url.pathname)) {
        const asset = assets.get(url.pathname);
        outgoing.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'no-store' }).end(asset.body);
        return;
      }
      if (!url.pathname.startsWith('/api/')) { outgoing.writeHead(404).end(); return; }
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
      if (result === null) {
        outgoing.destroy();
        return;
      }
      outgoing.writeHead(result.status, Object.fromEntries(result.headers));
      outgoing.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      outgoing.writeHead(500).end('Local integration bridge failed');
    }
  };
  const server = createServer((incoming, outgoing) => {
    const request = handle(incoming, outgoing);
    active.add(request);
    void request.finally(() => active.delete(request));
  });
  server.drain = () => Promise.allSettled([...active]);
  return server;
}

export default {
  async prepare({ baseURL, uiBundleRoot }) {
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
    const { runAgent } = loadTS('./src/server/agent.ts', entrypoint);
    const { seedDemo } = loadTS('./scripts/demo-data.ts', entrypoint);
    const migration = await readFile(join(root, 'drizzle', '0001_returnops.sql'), 'utf8');
    const fixtureRunId = `pr8-local-${randomUUID()}`;
    const directory = await mkdtemp(join(tmpdir(), 'returnops-qa-'));
    const options = {
      modules: true, script: 'export default {fetch(){return new Response(null,{status:404})}}',
      host: '127.0.0.1', cf: false, d1Persist: directory, d1Databases: { DB: fixtureRunId }
    };
    let miniflare = new Miniflare(options);
    let server;
    let held;
    const dispose = async () => {
      held?.release();
      try {
        if (server?.listening) {
          // Stop accepting requests and drain any active handler before disposing D1.
          const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
          await server.drain();
          server.closeAllConnections();
          await closed;
        }
      } finally {
        await miniflare.dispose();
        if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('returnops-qa-')) {
          throw new Error('Unexpected local D1 temporary directory.');
        }
        await rm(directory, { recursive: true, force: true });
      }
    };
    try {
      let db = await miniflare.getD1Database('DB');
      // Same statement boundaries as PR #8's migration tests, including trigger bodies.
      for (const sql of migration.match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g) ?? []) await db.prepare(sql.trim()).run();
      await seedDemo(db);
      const { roles, headers } = sessions();
      const config = { SITES_IDENTITY_VERIFIED: 'true', OWNER_USER_IDS: 'qa-owner', MEMBER_USER_IDS: 'qa-member' };
      const assets = new Map();
      const ui = uiBundleRoot;
      if (ui) {
        if (!isAbsolute(ui)) throw new Error('UI bundle root must be absolute.');
        for (const [url, file, type] of [
          ['/', 'index.html', 'text/html; charset=utf-8'],
          ['/app.js', 'app.js', 'text/javascript; charset=utf-8'],
          ['/app.css', 'app.css', 'text/css; charset=utf-8']
        ]) assets.set(url, { type, body: await readFile(join(ui, file)) });
      }
      let agentMode = 'ok';
      let dropResponse = false;
      const runner = async context => {
        const current = held;
        if (current) {
          current.enter();
          await current.gate;
          held = undefined;
        }
        if (agentMode === 'ok') return testAgent();
        const { runFault } = await import('./agent-faults.mjs');
        return runFault(agentMode, context, runAgent);
      };
      const localD1 = {
        async patchOrder(orderId, changes) {
          const columns = { amountVnd: 'amount_vnd', deliveredAt: 'delivered_at', orderVersion: 'order_version', tracking: 'tracking', reasonGroup: 'reason_group', itemCondition: 'item_condition', riskFlags: 'risk_flags' };
          const entries = Object.entries(changes);
          if (!entries.length || entries.some(([key]) => !Object.hasOwn(columns, key))) throw new Error('Unsupported order fixture fields.');
          await db.prepare(`UPDATE orders SET ${entries.map(([key]) => `${columns[key]}=?`).join(',')} WHERE id=?`)
            .bind(...entries.map(([key, value]) => key === 'riskFlags' ? JSON.stringify(value) : value), orderId).run();
        },
        async patchEvidence(caseId, evidenceId, changes) {
          const columns = { tracking: 'tracking', orderVersion: 'order_version', reviewStatus: 'review_status' };
          const entries = Object.entries(changes);
          if (!entries.length || entries.some(([key]) => !Object.hasOwn(columns, key))) throw new Error('Unsupported evidence fixture fields.');
          if (!await db.prepare('SELECT id FROM evidence WHERE case_id=? AND id=?').bind(caseId, evidenceId).first()) throw new Error('Unknown fixture proof.');
          await db.batch([
            db.prepare(`UPDATE evidence SET ${entries.map(([key]) => `${columns[key]}=?`).join(',')},evidence_version=evidence_version+1 WHERE case_id=? AND id=?`)
              .bind(...entries.map(([, value]) => value), caseId, evidenceId),
            db.prepare('UPDATE cases SET evidence_version=evidence_version+1 WHERE id=?').bind(caseId)
          ]);
        },
        async seedForeignCase() {
          const id = randomUUID();
          await db.batch([
            db.prepare("INSERT INTO shop_policy(shop_id) VALUES('foreign-shop')"),
            db.prepare("INSERT INTO orders(id,shop_id,amount_vnd,delivered_at,tracking,order_version,reason_group,item_condition) VALUES('foreign-order','foreign-shop',1000,unixepoch(),'foreign-tracking',1,'DAMAGE','DAMAGED')"),
            db.prepare("INSERT INTO cases(id,shop_id,order_id,claim,status,created_at,updated_at) VALUES(?,'foreign-shop','foreign-order','foreign-secret-marker','NEW',unixepoch(),unixepoch())").bind(id)
          ]);
          return id;
        },
        configureAgent(mode) { agentMode = mode; },
        async failNextReceiptInsert() {
          await db.prepare("CREATE TRIGGER qa_receipt_fault BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'QA receipt fault'); END;").run();
          return async () => { await db.prepare('DROP TRIGGER IF EXISTS qa_receipt_fault').run(); };
        },
        dropNextCommittedResponse() { dropResponse = true; },
        async restartStore() {
          await miniflare.dispose();
          miniflare = new Miniflare(options);
          db = await miniflare.getD1Database('DB');
        },
        async resetStore() {
          const statements = ['receipts', 'events', 'rule_suggestions', 'rules', 'evidence', 'demo_proofs'].map(table => db.prepare(`DELETE FROM ${table}`));
          statements.push(db.prepare("DELETE FROM operations WHERE kind='EVALUATION'"), db.prepare("DELETE FROM operations WHERE kind='REQUEST'"));
          statements.push(...['cases', 'orders', 'shop_policy'].map(table => db.prepare(`DELETE FROM ${table}`)));
          await db.batch(statements);
          await seedDemo(db);
        },
        setIdentityTrust(enabled) { config.SITES_IDENTITY_VERIFIED = String(enabled); },
        async readReviewAcknowledgement(key) {
          const row = await db.prepare("SELECT response_body FROM operations WHERE kind='REQUEST' AND action='review-evidence' AND idempotency_key=?").bind(key).first();
          if (!row) throw new Error('No committed fixture review acknowledgement.');
          return JSON.parse(row.response_body);
        },
        holdNextEvaluation() {
          if (held) throw new Error('A TEST evaluation is already held.');
          let enter, release, expired;
          const entered = new Promise((resolve, reject) => { enter = resolve; expired = reject; });
          const gate = new Promise(resolve => { release = resolve; });
          const timer = setTimeout(() => { expired(new Error('TEST agent did not reach the hold within 5 seconds.')); release(); }, 5000);
          held = { gate, enter: () => { clearTimeout(timer); enter(); }, release: () => { clearTimeout(timer); release(); } };
          return { entered, release: held.release };
        },
        async invalidateProof(caseId, evidenceId) {
          const proof = await db.prepare('SELECT id FROM evidence WHERE id=? AND case_id=?').bind(evidenceId, caseId).first();
          if (!proof) throw new Error('Proof does not belong to this local fixture.');
          await db.batch([
            db.prepare("UPDATE evidence SET tracking=tracking||'-changed',evidence_version=evidence_version+1 WHERE id=? AND case_id=?").bind(evidenceId, caseId),
            db.prepare('UPDATE cases SET evidence_version=evidence_version+1 WHERE id=?').bind(caseId)
          ]);
        },
        async inspect(caseId) {
          return db.prepare(`SELECT
            (SELECT count(*) FROM receipts WHERE case_id=c.id) AS receiptCount,
            (SELECT count(*) FROM rules WHERE source_case_id=c.id) AS ruleCount,
            (SELECT count(*) FROM events WHERE case_id=c.id AND type IN ('suggestion.accepted','suggestion.rejected')) AS transitionCount,
            (SELECT count(*) FROM operations WHERE case_id=c.id AND kind='EVALUATION') AS evaluationCount,
            p.active_rules_version AS activeRulesVersion
            FROM cases c JOIN shop_policy p ON p.shop_id=c.shop_id WHERE c.id=?`).bind(caseId).first();
        }
      };
      server = localIngress(target.origin, roles, async request => {
        const response = await handleApi(request, db, config, runner);
        if (dropResponse && response.ok && request.method === 'POST') {
          dropResponse = false;
          return null;
        }
        return response;
      }, assets);
      const ready = once(server, 'listening');
      server.listen(Number(target.port), '127.0.0.1');
      await ready;
      runs.set(fixtureRunId, dispose);
      return { fixtureRunId, executionMode: 'TEST', headers, localD1 };
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
