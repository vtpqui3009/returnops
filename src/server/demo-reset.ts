import { z } from "zod";
import { demoStatements } from "../../scripts/demo-data";
import { owner, type AuthConfig } from "./auth";
import { ApiFault, hashPayload, idempotency, parseBody, requireOrigin, type Actor } from "./http";
import { json } from "./mutations";

/** Atomic shared-demo reset. Reset acknowledgements survive later resets. */
export async function resetSharedDemo(request: Request, db: D1Database, config: AuthConfig, a: Actor) {
  if (config.RETURNOPS_SIGNED_IN_DEMO !== "true") throw new ApiFault(404, "NOT_FOUND", "Route not found");
  owner(a);
  if (request.method !== "POST") throw new ApiFault(405, "METHOD_NOT_ALLOWED", "POST required");
  requireOrigin(request);
  const key = idempotency(request);
  const body = await parseBody(request, z.object({confirm:z.literal("reset-shared-demo")}).strict());
  const hash = hashPayload(body);
  const replay = async () => {
    const saved = await db.prepare("SELECT payload_hash,response_body FROM operations WHERE shop_id=? AND actor_id=? AND kind='REQUEST' AND method='POST' AND action='demo-reset' AND resource_id='demo-shop' AND idempotency_key=?").bind(a.shopId,a.id,key).first<{payload_hash:string;response_body:string}>();
    if (saved && saved.payload_hash !== hash) throw new ApiFault(409, "IDEMPOTENCY_CONFLICT", "Idempotency key already used");
    return saved ? json(JSON.parse(saved.response_body)) : null;
  };
  const existing = await replay();
  if (existing) return existing;
  const target = await db.prepare("SELECT count(*) n,min(shop_id) id,max(config_version) version FROM shop_policy").first<{n:number;id:string;version:number}>();
  if (a.shopId !== "demo-shop" || target?.n !== 1 || target.id !== a.shopId) throw new ApiFault(409,"RESET_TARGET_MISMATCH","Only the dedicated shared demo can be reset");
  const guard = crypto.randomUUID();
  const result = { reset: true, caseCount: 5 };
  const statements = [
    db.prepare("INSERT INTO commit_guards(id,ok) VALUES(?,(SELECT CASE WHEN count(*)=1 AND min(shop_id)='demo-shop' AND max(config_version)=? THEN 1 ELSE 0 END FROM shop_policy))").bind(guard,target.version),
    ...["receipts","events","rule_suggestions","rules","evidence","demo_proofs"].map(table=>db.prepare(`DELETE FROM ${table}`)),
    db.prepare("DELETE FROM operations WHERE kind='EVALUATION'"),
    db.prepare("DELETE FROM operations WHERE kind='REQUEST' AND (action IS NULL OR action<>'demo-reset')"),
    db.prepare("DELETE FROM cases"),
    db.prepare("DELETE FROM orders"),
    // Keep the policy parent for durable reset acknowledgements; fence old snapshots.
    db.prepare("UPDATE shop_policy SET active_rules_version=1,hard_cap_vnd=300000,window_seconds=604800,config_version=config_version+1 WHERE shop_id='demo-shop'"),
    ...demoStatements(db, false),
  ];
  for (const [suffix, claim] of [
    ["a","A · Nhận sai kích cỡ"], ["b","B · Hàng hư hỏng, cần bằng chứng đóng gói"],
    ["c","C · Tranh chấp giao hàng"], ["d","D · Không vừa, hàng chưa dùng còn tem"],
    ["e","E · Thử quy tắc học từ D"],
  ]) {
    const caseId = crypto.randomUUID(), orderId = `demo-${suffix}`;
    statements.push(db.prepare("INSERT INTO cases(id,shop_id,order_id,claim,evidence_version,status,created_at,updated_at) VALUES(?,'demo-shop',?,?,(SELECT CASE WHEN count(*)>0 THEN 1 ELSE 0 END FROM demo_proofs WHERE order_id=?),'NEW',unixepoch(),unixepoch())").bind(caseId,orderId,claim,orderId));
    statements.push(db.prepare(`INSERT INTO evidence(id,case_id,shop_id,order_id,order_version,tracking,type,source,reference,observed_at,evidence_version,review_status,verified_by,verified_at,review_reason)
      SELECT ?,?,'demo-shop',o.id,o.order_version,o.tracking,p.type,p.source,p.reference,unixepoch(),1,p.review_status,
      CASE WHEN p.review_status='VERIFIED' THEN 'demo-owner-review' ELSE NULL END,
      CASE WHEN p.review_status='VERIFIED' THEN unixepoch() ELSE NULL END,
      CASE WHEN p.review_status='VERIFIED' THEN 'Seeded synthetic owner review' ELSE NULL END
      FROM demo_proofs p JOIN orders o ON o.id=p.order_id WHERE o.id=?`).bind(crypto.randomUUID(),caseId,orderId));
  }
  statements.push(
    db.prepare("INSERT INTO operations(id,kind,shop_id,actor_id,method,action,resource_id,idempotency_key,payload_hash,http_status,response_body,status,created_at,updated_at) VALUES(?,'REQUEST',?,?,'POST','demo-reset','demo-shop',?,?,200,?,'COMPLETED',unixepoch(),unixepoch())").bind(crypto.randomUUID(),a.shopId,a.id,key,hash,JSON.stringify(result)),
    db.prepare("DELETE FROM commit_guards WHERE id=?").bind(guard),
  );
  try { await db.batch(statements); }
  catch (error) {
    // A concurrent identical request may have committed; a failed batch rolls back.
    const repeated = await replay();
    if (repeated) return repeated;
    if (/CHECK constraint failed: ok\s*=\s*1/i.test(String(error))) throw new ApiFault(409,"RESET_CONFLICT","Another reset changed the demo; reload before trying again");
    throw error;
  }
  return json(result);
}
