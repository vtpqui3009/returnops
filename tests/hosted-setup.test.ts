import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";
import { initializeDemo, signedInIdentity } from "../src/server/hosted-setup";

const secret = "test-only-initializer-secret-at-least-32-characters";
const config = { RETURNOPS_INITIALIZE_SECRET: secret };
function request(token = secret, origin = "https://returnops.local") {
  return new Request("https://returnops.local/api/operator/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: "initialize-synthetic-demo" }),
  });
}
async function database() {
  const runtime = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('ok')}}", d1Databases: { DB: `setup-${crypto.randomUUID()}` } });
  try {
    const db = await runtime.getD1Database("DB");
    const sql = await readFile(new URL("../drizzle/0001_returnops.sql", import.meta.url), "utf8");
    for (const s of sql.trim().match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g) ?? []) await db.prepare(s.trim()).run();
    return { db, runtime };
  } catch (error) { await runtime.dispose(); throw error; }
}
test("initializer rejects missing/wrong secret and bad origin before writing", async (t) => {
  const { db, runtime } = await database(); t.after(() => runtime.dispose());
  assert.equal((await initializeDemo(request(), db, {})).status, 404);
  assert.equal((await initializeDemo(request("wrong"), db, config)).status, 403);
  assert.equal((await initializeDemo(request(secret, "https://other.test"), db, config)).status, 403);
  assert.equal((await db.prepare("SELECT count(*) n FROM shop_policy").first<{n:number}>())?.n, 0);
});
test("initializer is atomic, repeat-safe and preserves changed workflow state", async (t) => {
  const { db, runtime } = await database(); t.after(() => runtime.dispose());
  const results = await Promise.all([initializeDemo(request(), db, config), initializeDemo(request(), db, config)]);
  assert.deepEqual(results.map(r => r.status), [200, 200]);
  assert.equal((await db.prepare("SELECT count(*) n FROM orders").first<{n:number}>())?.n, 5);
  await db.prepare("UPDATE shop_policy SET active_rules_version=2 WHERE shop_id='demo-shop'").run();
  await db.prepare("UPDATE orders SET order_version=2 WHERE id='demo-a'").run();
  await db.prepare("INSERT INTO orders(id,shop_id,amount_vnd,tracking,order_version,reason_group,item_condition) VALUES('demo-extra','demo-shop',100,'extra',1,'SIZE_MISMATCH','WRONG_SIZE')").run();
  assert.equal((await initializeDemo(request(), db, config)).status, 200);
  assert.equal((await db.prepare("SELECT order_version v FROM orders WHERE id='demo-a'").first<{v:number}>())?.v, 2);
  assert.equal((await db.prepare("SELECT active_rules_version v FROM shop_policy").first<{v:number}>())?.v, 2);
  assert.equal((await db.prepare("SELECT count(*) n FROM orders").first<{n:number}>())?.n, 6);
});
test("initializer refuses partial or unrelated data without altering it", async (t) => {
  const { db, runtime } = await database(); t.after(() => runtime.dispose());
  await db.prepare("INSERT INTO shop_policy(shop_id) VALUES('demo-shop')").run();
  assert.equal((await initializeDemo(request(), db, config)).status, 409);
  assert.equal((await db.prepare("SELECT count(*) n FROM orders").first<{n:number}>())?.n, 0);
});
test("initializer enforces its method and strict confirmation contract", async (t) => {
  const { db, runtime } = await database(); t.after(() => runtime.dispose());
  const url = "https://returnops.local/api/operator/initialize";
  const headers = { Authorization: `Bearer ${secret}`, Origin: "https://returnops.local", "Content-Type": "application/json" };
  assert.equal((await initializeDemo(new Request(url, { headers }), db, config)).status, 405);
  for (const body of [{}, { confirm: "wrong" }, { confirm: "initialize-synthetic-demo", reset: true }]) {
    assert.equal((await initializeDemo(new Request(url, {method:"POST", headers, body:JSON.stringify(body)}), db, config)).status, 400);
  }
  assert.equal((await initializeDemo(new Request(url, {method:"POST", headers:{...headers,"Content-Type":"text/plain"}, body:'{}'}), db, config)).status, 400);
  assert.equal((await db.prepare("SELECT count(*) n FROM shop_policy").first<{n:number}>())?.n, 0);
});
test("identity reports only a verified signed-in user's own ID, without granting a role", () => {
  const r = new Request("https://returnops.local/api/identity", { headers: {"oai-authenticated-user-id":"site-owner", "oai-authenticated-user-email":"owner@example.test"} });
  assert.equal(signedInIdentity(r, {}).status, 401);
  assert.equal(signedInIdentity(new Request(r.url), {SITES_IDENTITY_VERIFIED:"true"}).status, 401);
  const response = signedInIdentity(r, {SITES_IDENTITY_VERIFIED:"true"});
  assert.equal(response.status, 200);
  return response.json().then(body => assert.deepEqual(body, {userId:"site-owner"}));
});
