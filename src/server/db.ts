import type {
  ActiveRule,
  CaseDetail,
  Evidence,
  OrderSnapshot,
  RiskFlag,
  RuleSuggestion,
  SimulatedReceipt,
  TimelineEvent,
} from "../shared/contracts";
import { ApiFault, type Actor } from "./http";
export type Db = D1Database;
export interface CaseRow {
  id: string;
  shop_id: string;
  order_id: string;
  claim: string;
  case_version: number;
  evidence_version: number;
  status: CaseDetail["status"];
  flags: string;
  reasons: string;
  missing_evidence: string;
  decision: CaseDetail["decision"];
  applied_rule_id: string | null;
  applied_rule_version: number | null;
  source_case_id: string | null;
  pending_evaluation_operation_id: string | null;
  created_at: number;
  updated_at: number;
}
export interface OrderRow {
  id: string;
  shop_id: string;
  amount_vnd: number;
  delivered_at: number | null;
  tracking: string;
  order_version: number;
  reason_group: string;
  item_condition: string;
  risk_flags: string;
}
export interface PolicyRow {
  shop_id: string;
  active_rules_version: number;
  hard_cap_vnd: number;
  window_seconds: number;
  config_version: number;
}
export interface OperationRow {
  id: string;
  kind: "REQUEST" | "EVALUATION";
  shop_id: string;
  actor_id: string;
  http_status: number;
  response_body: string;
  case_id: string;
  snapshot: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  expected_case_version: number;
  expected_rules_version: number;
  attempt_token: string | null;
  lease_until: number | null;
  execution_mode: "LIVE" | "TEST" | "REPLAY" | null;
  provider_response_id: string | null;
  model: string | null;
  result: string | null;
  error: string | null;
  payload_hash: string;
  created_at: number;
}
export interface Snapshot {
  case: CaseRow;
  order: OrderSnapshot & { riskFlags: RiskFlag[] };
  evidence: Evidence[];
  rules: ActiveRule[];
  policy: PolicyRow;
}
export function stmt(db: Db, sql: string, ...values: unknown[]) {
  return db.prepare(sql).bind(...values);
}
export async function first<T>(db: Db, sql: string, ...values: unknown[]) {
  return stmt(db, sql, ...values).first<T>();
}
export async function rows<T>(db: Db, sql: string, ...values: unknown[]) {
  return (await stmt(db, sql, ...values).all<T>()).results;
}
export function decode<T>(value: string): T {
  return JSON.parse(value) as T;
}
export function orderSnapshot(row: OrderRow): Snapshot["order"] {
  return {
    id: row.id,
    orderVersion: row.order_version,
    amountVnd: row.amount_vnd,
    deliveredAt: row.delivered_at,
    tracking: row.tracking,
    reasonGroup: row.reason_group,
    itemCondition: row.item_condition,
    riskFlags: decode(row.risk_flags),
  };
}
export function evidenceRow(row: Record<string, unknown>): Evidence {
  return {
    id: String(row.id),
    caseId: String(row.case_id),
    orderId: String(row.order_id),
    orderVersion: Number(row.order_version),
    tracking: String(row.tracking),
    type: String(row.type),
    source: row.source as Evidence["source"],
    reference: String(row.reference),
    observedAt: Number(row.observed_at),
    evidenceVersion: Number(row.evidence_version),
    reviewStatus: row.review_status as Evidence["reviewStatus"],
    verifiedBy: row.verified_by as string | null,
    verifiedAt: row.verified_at as number | null,
    reviewReason: row.review_reason as string | null,
  };
}
export function ruleRow(row: Record<string, unknown>): ActiveRule {
  return {
    id: String(row.id),
    version: Number(row.version),
    sourceCaseId: row.source_case_id as string | null,
    decision: "RETURN_THEN_REFUND",
    reasonGroup: String(row.reason_group),
    itemCondition: String(row.item_condition),
  };
}
export function suggestionRow(row: Record<string, unknown>): RuleSuggestion {
  return {
    id: String(row.id),
    sourceCaseId: String(row.source_case_id),
    suggestionVersion: Number(row.suggestion_version),
    status: row.status as RuleSuggestion["status"],
    decision: "RETURN_THEN_REFUND",
    reasonGroup: String(row.reason_group),
    itemCondition: String(row.item_condition),
    ownerReason: String(row.owner_reason),
    ruleId: row.rule_id as string | null,
  };
}
export function receiptRow(row: Record<string, unknown>): SimulatedReceipt {
  return {
    id: String(row.id),
    mode: "SIMULATED",
    completionMode: row.completion_mode as "AUTO" | "MANUAL",
    agentRunId: row.agent_run_id as string | null,
    decision: row.decision as SimulatedReceipt["decision"],
    packet: String(row.packet),
    reply: String(row.reply),
    appliedRuleId: row.applied_rule_id as string | null,
    appliedRuleVersion: row.applied_rule_version as number | null,
    sourceCaseId: row.source_case_id as string | null,
  };
}
/** One D1 batch gives a consistent read snapshot across resources. */
export async function loadSnapshot(
  db: Db,
  shop: string,
  id: string,
): Promise<Snapshot> {
  const result = await db.batch<Record<string, unknown>>([
    stmt(db, "SELECT * FROM cases WHERE shop_id=? AND id=?", shop, id),
    stmt(
      db,
      "SELECT o.* FROM orders o JOIN cases c ON c.order_id=o.id AND c.shop_id=o.shop_id WHERE c.shop_id=? AND c.id=?",
      shop,
      id,
    ),
    stmt(db, "SELECT * FROM evidence WHERE shop_id=? AND case_id=?", shop, id),
    stmt(db, "SELECT * FROM rules WHERE shop_id=? ORDER BY id", shop),
    stmt(db, "SELECT * FROM shop_policy WHERE shop_id=?", shop),
  ]);
  const c = result[0].results[0] as unknown as CaseRow | undefined;
  if (!c) throw new ApiFault(404, "NOT_FOUND", "Case not found");
  if (!result[1].results[0] || !result[4].results[0])
    throw new ApiFault(500, "INTERNAL_ERROR", "Canonical data unavailable");
  return {
    case: c,
    order: orderSnapshot(result[1].results[0] as unknown as OrderRow),
    evidence: result[2].results.map(evidenceRow),
    rules: result[3].results.map(ruleRow),
    policy: result[4].results[0] as unknown as PolicyRow,
  };
}
/** CHECK failure deliberately aborts the entire D1 batch, including audit and acknowledgements. */
export function guard(
  db: Db,
  id: string,
  condition: string,
  values: unknown[] = [],
) {
  return stmt(
    db,
    `INSERT INTO commit_guards(id,ok) VALUES (?,CASE WHEN ${condition} THEN 1 ELSE 0 END)`,
    id,
    ...values,
  );
}
export async function atomic(
  db: Db,
  condition: string,
  values: unknown[],
  changes: D1PreparedStatement[],
) {
  const id = crypto.randomUUID();
  try {
    return await db.batch<Record<string, unknown>>([
      guard(db, id, condition, values),
      ...changes,
      stmt(db, "DELETE FROM commit_guards WHERE id=?", id),
    ]);
  } catch (error) {
    if (String(error).includes("CHECK constraint failed: ok=1"))
      throw new ApiFault(
        409,
        "STALE_VERSION",
        "State changed; reload current versions",
      );
    throw error;
  }
}
export function snapshotCondition(s: Snapshot, monetary = false) {
  let sql = `EXISTS(SELECT 1 FROM cases WHERE id=? AND shop_id=? AND case_version=? AND evidence_version=? AND status=?)
 AND EXISTS(SELECT 1 FROM orders WHERE id=? AND shop_id=? AND order_version=? AND tracking=?)
 AND EXISTS(SELECT 1 FROM shop_policy WHERE shop_id=? AND active_rules_version=? AND config_version=?)`;
  const values: unknown[] = [
    s.case.id,
    s.case.shop_id,
    s.case.case_version,
    s.case.evidence_version,
    s.case.status,
    s.order.id,
    s.case.shop_id,
    s.order.orderVersion,
    s.order.tracking,
    s.case.shop_id,
    s.policy.active_rules_version,
    s.policy.config_version,
  ];
  if (monetary) {
    sql += ` AND EXISTS(SELECT 1 FROM orders o JOIN shop_policy p ON p.shop_id=o.shop_id WHERE o.id=? AND o.shop_id=?
 AND o.amount_vnd BETWEEN 1 AND min(p.hard_cap_vnd,300000) AND unixepoch() BETWEEN o.delivered_at AND o.delivered_at+min(p.window_seconds,604800))`;
    values.push(s.order.id, s.case.shop_id);
  }
  return { sql, values };
}
export function event(
  db: Db,
  s: Snapshot,
  operationId: string,
  type: string,
  actorId: string | null,
  payload: unknown,
  sequence = 0,
) {
  return stmt(
    db,
    "INSERT INTO events(id,case_id,shop_id,operation_id,sequence,type,actor_id,payload,occurred_at) VALUES(?,?,?,?,?,?,?,?,unixepoch())",
    crypto.randomUUID(),
    s.case.id,
    s.case.shop_id,
    operationId,
    sequence,
    type,
    actorId,
    JSON.stringify(payload),
  );
}
export async function detail(
  db: Db,
  actor: Actor,
  id: string,
): Promise<CaseDetail> {
  const s = await loadSnapshot(db, actor.shopId, id);
  const result = await db.batch<Record<string, unknown>>([
    stmt(
      db,
      "SELECT * FROM operations WHERE shop_id=? AND case_id=? AND kind='EVALUATION' ORDER BY created_at DESC,rowid DESC LIMIT 1",
      actor.shopId,
      id,
    ),
    stmt(
      db,
      "SELECT * FROM events WHERE shop_id=? AND case_id=? ORDER BY occurred_at,rowid",
      actor.shopId,
      id,
    ),
    stmt(db, "SELECT * FROM receipts WHERE case_id=?", id),
  ]);
  const op = result[0].results[0] as unknown as OperationRow | undefined;
  const timeline = result[1].results.map((row) => {
    const payload = decode<Record<string, unknown>>(String(row.payload));
    return {
      id: String(row.id),
      type: String(row.type),
      actorId: row.actor_id as string | null,
      occurredAt: Number(row.occurred_at),
      evaluationStatus: (payload.evaluationStatus ??
        null) as TimelineEvent["evaluationStatus"],
      executionMode: (payload.executionMode ??
        null) as TimelineEvent["executionMode"],
      completionMode: (payload.completionMode ??
        null) as TimelineEvent["completionMode"],
      details: payload,
    };
  });
  return {
    id: s.case.id,
    order: s.order,
    caseVersion: s.case.case_version,
    evidenceVersion: s.case.evidence_version,
    activeRulesVersion: s.policy.active_rules_version,
    status: s.case.status,
    claim: s.case.claim,
    reasons: decode(s.case.reasons),
    flags: decode(s.case.flags),
    missingEvidence: decode(s.case.missing_evidence),
    decision: s.case.decision,
    appliedRuleId: s.case.applied_rule_id,
    appliedRuleVersion: s.case.applied_rule_version,
    sourceCaseId: s.case.source_case_id,
    pendingEvaluationOperationId: s.case.pending_evaluation_operation_id,
    evidence: s.evidence,
    timeline,
    receipt: result[2].results[0] ? receiptRow(result[2].results[0]) : null,
    evaluation: op
      ? {
          id: op.id,
          status: op.status,
          executionMode: op.execution_mode,
          providerResponseId: op.provider_response_id,
          model: op.model,
          error: op.error ? decode(op.error) : null,
          result: op.result ? decode(op.result) : null,
        }
      : null,
  };
}
