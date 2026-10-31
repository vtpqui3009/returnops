import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

async function database() {
  const runtime = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok') } }", d1Databases: { DB: 'returnops-test' } });
  try {
    const db = await runtime.getD1Database('DB');
    const sql = await readFile(new URL('../drizzle/0001_returnops.sql', import.meta.url), 'utf8');
    const statements = sql.trim().match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g) ?? [];
    for (const [index, statement] of statements.entries()) {
      try { await db.prepare(statement.trim()).run(); }
      catch (error) { throw new Error(`migration statement ${index + 1} failed: ${statement.trim().slice(0, 80)}; ${String(error)}`); }
    }
    return { runtime, db };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}

test('migration runs against local D1 and preserves its schema invariants', async (t) => {
  const { runtime, db } = await database();
  t.after(() => runtime.dispose());
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>();
  const names = new Set(tables.results.map(row => row.name));
  for (const table of ['orders', 'shop_policy', 'cases', 'evidence', 'operations', 'events', 'receipts', 'rules', 'rule_suggestions']) assert.ok(names.has(table), `missing ${table}`);
  await db.prepare("INSERT INTO shop_policy(shop_id) VALUES(?)").bind('shop').run();
  await db.prepare("INSERT INTO orders(id,shop_id,amount_vnd,delivered_at,tracking,order_version,reason_group,item_condition) VALUES(?,?,?,?,?,?,?,?)")
    .bind('order', 'shop', 100, 1, 'tracking', 1, 'SIZE_MISMATCH', 'WRONG_SIZE').run();
  await db.prepare("INSERT INTO cases(id,shop_id,order_id,claim,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .bind('case', 'shop', 'order', 'claim', 'NEW', 1, 1).run();
  await db.prepare("INSERT INTO operations(id,kind,shop_id,actor_id,method,action,resource_id,idempotency_key,payload_hash,http_status,response_body,case_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind('op-1', 'REQUEST', 'shop', 'owner', 'POST', 'test', 'case', 'key-1', 'hash', 200, '{}', 'case', 'COMPLETED', 1, 1).run();
  await db.prepare("INSERT INTO receipts(id,case_id,operation_id,completion_mode,decision,packet,reply) VALUES(?,?,?,?,?,?,?)")
    .bind('receipt-1', 'case', 'op-1', 'AUTO', 'RETURN_THEN_REFUND', 'SIMULATED', 'reply').run();
  await assert.rejects(() => db.prepare("INSERT INTO receipts(id,case_id,operation_id,completion_mode,decision,packet,reply) VALUES(?,?,?,?,?,?,?)")
    .bind('receipt-2', 'case', 'op-1', 'AUTO', 'RETURN_THEN_REFUND', 'SIMULATED', 'reply').run());
  await assert.rejects(() => db.prepare("INSERT INTO orders(id,shop_id,amount_vnd,delivered_at,tracking,order_version,reason_group,item_condition) VALUES(?,?,?,?,?,?,?,?)")
    .bind('bad', 'shop', 0, 1, 'tracking', 1, 'SIZE_MISMATCH', 'WRONG_SIZE').run());
});
