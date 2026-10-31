import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { seedDemo } from "../../scripts/demo-data";
import { ApiFault, apiError, parseBody, requireOrigin } from "./http";
import { json } from "./mutations";

interface SetupConfig {
  RETURNOPS_INITIALIZE_SECRET?: string;
  SITES_IDENTITY_VERIFIED?: string;
}
const tables = ["shop_policy", "orders", "cases", "evidence", "operations", "events", "receipts", "rules", "rule_suggestions", "demo_proofs", "commit_guards"] as const;

/** Recognize immutable fixture IDs, not mutable policy/order/workflow versions. */
async function initialized(db: D1Database) {
  const row = await db.prepare(`SELECT
    (SELECT count(*) FROM shop_policy) AS shops,
    (SELECT count(*) FROM shop_policy WHERE shop_id='demo-shop') AS demo,
    (SELECT count(*) FROM orders WHERE shop_id='demo-shop' AND id IN ('demo-a','demo-b','demo-c','demo-d','demo-e')) AS orders,
    (SELECT count(*) FROM rules WHERE shop_id='demo-shop' AND id IN ('builtin-size','builtin-damage')) AS rules,
    (SELECT count(*) FROM demo_proofs WHERE id IN ('proof-a','proof-c','proof-d','proof-e')) AS proofs`).first<{shops:number;demo:number;orders:number;rules:number;proofs:number}>();
  return row?.shops === 1 && row.demo === 1 && row.orders === 5 && row.rules === 2 && row.proofs === 4;
}

/** Operator-only provisioning; disabled when its separate secret is removed. */
export async function initializeDemo(request: Request, db: D1Database, config: SetupConfig) {
  try {
    const secret = config.RETURNOPS_INITIALIZE_SECRET;
    if (!secret || secret.length < 32) throw new ApiFault(404, "NOT_FOUND", "Route not found");
    const provided = request.headers.get("authorization") ?? "";
    const hash = (s: string) => createHash("sha256").update(s).digest();
    if (!timingSafeEqual(hash(provided), hash(`Bearer ${secret}`))) throw new ApiFault(403, "FORBIDDEN", "Operator authorization required");
    if (request.method !== "POST") throw new ApiFault(405, "METHOD_NOT_ALLOWED", "POST required");
    requireOrigin(request);
    await parseBody(request, z.object({ confirm: z.literal("initialize-synthetic-demo") }).strict());
    if (await initialized(db)) return json({ initialized: true, created: false });
    // Names are fixed source constants; no SQL identifier comes from the request.
    const counts = await db.batch(tables.map(table => db.prepare(`SELECT count(*) AS n FROM ${table}`)));
    if (counts.some(result => (result.results[0] as {n:number}).n !== 0)) {
      if (await initialized(db)) return json({ initialized: true, created: false });
      throw new ApiFault(409, "INITIALIZATION_CONFLICT", "Database is not an empty demo target");
    }
    try {
      await seedDemo(db);
    } catch (error) {
      // A concurrent initializer may have won its atomic batch. Never reset/reseed.
      if (await initialized(db)) return json({ initialized: true, created: false });
      throw error;
    }
    return json({ initialized: true, created: true });
  } catch (error) { return apiError(error); }
}

/** Returns the caller's Site-scoped identity to support initial allowlist setup. */
export function signedInIdentity(request: Request, config: SetupConfig) {
  const id = request.headers.get("oai-authenticated-user-id");
  if (config.SITES_IDENTITY_VERIFIED !== "true" || !id || !request.headers.get("oai-authenticated-user-email")) return apiError(new ApiFault(401, "UNAUTHENTICATED", "Verified sign-in required"));
  return json({ userId: id });
}
