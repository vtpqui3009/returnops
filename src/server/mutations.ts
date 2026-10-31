import type { z } from "zod";
import type { AuthConfig } from "./auth";
import type { AgentConfig } from "./agent";
import {
  ApiFault,
  hashPayload,
  idempotency,
  parseBody,
  requireOrigin,
  type Actor,
} from "./http";
import { decode, first, stmt, type Db, type OperationRow } from "./db";
import { runEvaluation, type AgentRunner } from "./workflow";
export type BackendConfig = AuthConfig & AgentConfig;
interface Mutation {
  id: string;
  actor: Actor;
  key: string;
  hash: string;
  action: string;
  resource: string;
  method: string;
}
export function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export function acknowledgement(
  db: Db,
  m: Mutation,
  status: number,
  body: unknown,
  caseId: string | null,
) {
  return stmt(
    db,
    `INSERT INTO operations(id,kind,shop_id,actor_id,method,action,resource_id,idempotency_key,payload_hash,http_status,response_body,case_id,status,created_at,updated_at)
 VALUES(?,'REQUEST',?,?,?,?,?,?,?,?,?,?,'COMPLETED',unixepoch(),unixepoch())`,
    m.id,
    m.actor.shopId,
    m.actor.id,
    m.method,
    m.action,
    m.resource,
    m.key,
    m.hash,
    status,
    JSON.stringify(body),
    caseId,
  );
}
async function lookupRequest(db: Db, m: Mutation) {
  return first<OperationRow>(
    db,
    "SELECT * FROM operations WHERE kind='REQUEST' AND shop_id=? AND actor_id=? AND method=? AND action=? AND resource_id=? AND idempotency_key=?",
    m.actor.shopId,
    m.actor.id,
    m.method,
    m.action,
    m.resource,
    m.key,
  );
}
/** Dispatch errors cannot rewrite a durably committed REQUEST acknowledgement.
 * Pending/expired work remains recoverable through the same authenticated retry.
 */
async function driveAcceptedEvaluation(
  db: Db,
  shop: string,
  config: BackendConfig,
  runner: AgentRunner | undefined,
  operation: { id?: string; parentRequestId?: string },
) {
  try {
    const id =
      operation.id ??
      (
        await first<{ id: string }>(
          db,
          "SELECT id FROM operations WHERE parent_request_id=? AND kind='EVALUATION'",
          operation.parentRequestId,
        )
      )?.id;
    if (id) await runEvaluation(db, id, shop, config, runner);
  } catch {
    console.error(
      JSON.stringify({
        event: "evaluation.dispatch_unavailable",
        operationId: operation.id ?? null,
        parentRequestId: operation.parentRequestId ?? null,
        code: "EVALUATION_DISPATCH_UNAVAILABLE",
      }),
    );
  }
}
async function replay(
  db: Db,
  m: Mutation,
  config: BackendConfig,
  runner?: AgentRunner,
) {
  const saved = await lookupRequest(db, m);
  if (!saved) return null;
  if (saved.payload_hash !== m.hash)
    throw new ApiFault(
      409,
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key has a different payload",
    );
  await driveAcceptedEvaluation(db, m.actor.shopId, config, runner, {
    parentRequestId: saved.id,
  });
  return json(decode(saved.response_body), saved.http_status);
}
export async function mutate<T>(
  request: Request,
  db: Db,
  config: BackendConfig,
  a: Actor,
  schema: z.ZodType<T>,
  action: string,
  resource: string,
  run: (
    m: Mutation,
    body: T,
  ) => Promise<{ status: number; body: unknown; evalId?: string }>,
  runner?: AgentRunner,
) {
  requireOrigin(request);
  const body = await parseBody(request, schema);
  const m: Mutation = {
    id: crypto.randomUUID(),
    actor: a,
    key: idempotency(request),
    hash: hashPayload(body),
    action,
    resource,
    method: request.method,
  };
  const prior = await replay(db, m, config, runner);
  if (prior) return prior;
  let result;
  try {
    result = await run(m, body);
  } catch (error) {
    const winning = await replay(db, m, config, runner);
    if (winning) return winning;
    throw error;
  }
  if (result.evalId)
    await driveAcceptedEvaluation(db, a.shopId, config, runner, {
      id: result.evalId,
    });
  return json(result.body, result.status);
}
