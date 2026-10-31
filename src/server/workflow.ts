import type { ExecutionMode } from "../shared/contracts";
import { runAgent, type AgentConfig, type AgentResult } from "./agent";
import { type AgentContext } from "./agent-tools";
import { ApiFault, type Actor } from "./http";
import {
  atomic,
  decode,
  event,
  first,
  loadSnapshot,
  snapshotCondition,
  stmt,
  type Db,
  type OperationRow,
  type Snapshot,
} from "./db";
import { evaluatePolicy } from "./policy";
export type RunnerResult = Omit<AgentResult, "executionMode"> & {
  executionMode: ExecutionMode;
};
export type AgentRunner = (
  context: AgentContext,
  config: AgentConfig,
) => Promise<RunnerResult>;
export function policyFor(s: Snapshot, now = Math.floor(Date.now() / 1000)) {
  return evaluatePolicy(s.order, s.evidence, s.rules, now, {
    hardCapVnd: s.policy.hard_cap_vnd,
    windowSeconds: s.policy.window_seconds,
  });
}
export function evaluationIntent(
  db: Db,
  s: Snapshot,
  id: string,
  parent: string,
  caseVersion: number,
) {
  const snapshot: Snapshot = {
    ...s,
    case: {
      ...s.case,
      case_version: caseVersion,
      pending_evaluation_operation_id: id,
    },
  };
  return stmt(
    db,
    `INSERT INTO operations(id,kind,shop_id,parent_request_id,case_id,snapshot,status,expected_case_version,expected_rules_version,created_at,updated_at)
 VALUES(?,'EVALUATION',?,?,?,?, 'PENDING',?,?,unixepoch(),unixepoch())`,
    id,
    s.case.shop_id,
    parent,
    s.case.id,
    JSON.stringify(snapshot),
    caseVersion,
    s.policy.active_rules_version,
  );
}
export async function claimEvaluation(db: Db, id: string, shop: string) {
  const token = crypto.randomUUID();
  const op = await first<OperationRow>(
    db,
    `UPDATE operations SET status='RUNNING',attempt_token=?,lease_until=unixepoch()+60,updated_at=unixepoch()
 WHERE id=? AND shop_id=? AND kind='EVALUATION' AND (status='PENDING' OR (status='RUNNING' AND lease_until<=unixepoch())) RETURNING *`,
    token,
    id,
    shop,
  );
  return op ? { operation: op, token } : null;
}
export async function finalizeFailure(
  db: Db,
  op: OperationRow,
  token: string,
  s: Snapshot,
  fault: ApiFault,
  mode: ExecutionMode = "LIVE",
) {
  const error = { code: fault.code, message: fault.message };
  const diagnostics = policyFor(s);
  const fence = snapshotCondition(s, false);
  try {
    await atomic(
      db,
      "EXISTS(SELECT 1 FROM operations WHERE id=? AND shop_id=? AND kind='EVALUATION' AND status='RUNNING' AND attempt_token=? AND lease_until>unixepoch())",
      [op.id, op.shop_id, token],
      [
        stmt(
          db,
          "UPDATE operations SET status='FAILED',error=?,execution_mode=?,updated_at=unixepoch() WHERE id=?",
          JSON.stringify(error),
          mode,
          op.id,
        ),
        stmt(
          db,
          `UPDATE cases SET status='TECHNICAL_ERROR',flags=CASE WHEN ${fence.sql} THEN ? ELSE flags END,reasons=CASE WHEN ${fence.sql} THEN ? ELSE reasons END,missing_evidence=CASE WHEN ${fence.sql} THEN ? ELSE missing_evidence END,case_version=case_version+1,pending_evaluation_operation_id=NULL,updated_at=unixepoch()
 WHERE id=? AND shop_id=? AND case_version=? AND pending_evaluation_operation_id=? AND status!='COMPLETED'`,
          ...fence.values, JSON.stringify(diagnostics.flags),
          ...fence.values, JSON.stringify(diagnostics.reasons),
          ...fence.values, JSON.stringify(diagnostics.missingEvidence),
          s.case.id,
          s.case.shop_id,
          s.case.case_version,
          op.id,
        ),
        event(db, s, op.id, "evaluation.failed", null, {
          evaluationStatus: "FAILED",
          executionMode: mode,
          error,
        }),
      ],
    );
  } catch (error) {
    if (!(error instanceof ApiFault && error.status === 409)) throw error;
  }
}
/** A runner only owns its captured post-intent snapshot until its fenced lease expires. */
export async function runEvaluation(
  db: Db,
  id: string,
  shop: string,
  config: AgentConfig,
  runner: AgentRunner = runAgent,
) {
  const claim = await claimEvaluation(db, id, shop);
  if (!claim) return;
  const { operation: op, token } = claim;
  const s = decode<Snapshot>(op.snapshot);
  let executionMode: ExecutionMode = "LIVE";
  try {
    const current = await loadSnapshot(db, shop, s.case.id);
    if (
      current.case.case_version !== s.case.case_version ||
      current.case.pending_evaluation_operation_id !== id ||
      current.order.orderVersion !== s.order.orderVersion ||
      current.case.evidence_version !== s.case.evidence_version ||
      current.policy.active_rules_version !== s.policy.active_rules_version ||
      current.policy.config_version !== s.policy.config_version
    )
      throw new ApiFault(
        409,
        "STALE_EVALUATION",
        "Evaluation snapshot changed",
      );
    const policy = policyFor(s);
    const agent = await runner(
      { order: s.order, claim: s.case.claim, policy },
      config,
    );
    executionMode = agent.executionMode;
    const outcome = agent.escalated
      ? {
          ...policy,
          status: "NEEDS_OWNER_REVIEW" as const,
          decision: null,
          appliedRule: null,
          reasons: [...policy.reasons, "AGENT_ESCALATION"],
        }
      : policy;
    const guard = snapshotCondition(s, outcome.status === "COMPLETED");
    guard.sql +=
      " AND EXISTS(SELECT 1 FROM operations WHERE id=? AND status='RUNNING' AND attempt_token=? AND lease_until>unixepoch()) AND EXISTS(SELECT 1 FROM cases WHERE id=? AND pending_evaluation_operation_id=?)";
    guard.values.push(id, token, s.case.id, id);
    const rule = outcome.appliedRule;
    const result = { status: outcome.status, decision: outcome.decision };
    const changes = [
      stmt(
        db,
        `UPDATE cases SET status=?,decision=?,flags=?,reasons=?,missing_evidence=?,applied_rule_id=?,applied_rule_version=?,source_case_id=?,
 case_version=case_version+1,pending_evaluation_operation_id=NULL,updated_at=unixepoch() WHERE id=?`,
        outcome.status,
        outcome.decision,
        JSON.stringify(outcome.flags),
        JSON.stringify(outcome.reasons),
        JSON.stringify(outcome.missingEvidence),
        rule?.id ?? null,
        rule?.version ?? null,
        rule?.sourceCaseId ?? null,
        s.case.id,
      ),
      stmt(
        db,
        "UPDATE operations SET status='COMPLETED',execution_mode=?,provider_response_id=?,model=?,result=?,updated_at=unixepoch() WHERE id=?",
        agent.executionMode,
        agent.providerResponseId,
        agent.model,
        JSON.stringify(result),
        id,
      ),
      event(db, s, id, "evaluation.completed", null, {
        evaluationStatus: "COMPLETED",
        executionMode: agent.executionMode,
        completionMode: outcome.status === "COMPLETED" ? "AUTO" : null,
        ...result,
        toolFacts: agent.toolFacts,
        escalationReason: agent.escalationReason ?? null,
      }),
    ];
    if (outcome.status === "COMPLETED")
      changes.push(
        stmt(
          db,
          `INSERT INTO receipts(id,case_id,operation_id,completion_mode,agent_run_id,decision,packet,reply,applied_rule_id,applied_rule_version,source_case_id)
 VALUES(?,?,?,'AUTO',?,?,?,?,?,?,?)`,
          crypto.randomUUID(),
          s.case.id,
          id,
          id,
          outcome.decision,
          `SIMULATED RETURN_THEN_REFUND | order ${s.order.id} | ${s.order.amountVnd} VND`,
          agent.reply,
          rule?.id ?? null,
          rule?.version ?? null,
          rule?.sourceCaseId ?? null,
        ),
      );
    await atomic(db, guard.sql, guard.values, changes);
  } catch (error) {
    const fault =
      error instanceof ApiFault
        ? error
        : new ApiFault(
            503,
            "EVALUATION_FAILED",
            "Evaluation could not complete",
          );
    await finalizeFailure(db, op, token, s, fault, executionMode);
  }
}
export function assertMutable(s: Snapshot) {
  if (s.case.status === "COMPLETED")
    throw new ApiFault(
      409,
      "CASE_COMPLETED",
      "Completed cases cannot be changed",
    );
}
export function assertVersions(
  s: Snapshot,
  caseVersion: number,
  rulesVersion?: number,
) {
  if (
    s.case.case_version !== caseVersion ||
    (rulesVersion !== undefined &&
      s.policy.active_rules_version !== rulesVersion)
  )
    throw new ApiFault(409, "STALE_VERSION", "Reload current versions");
}
export function ownerCompletion(
  db: Db,
  s: Snapshot,
  operationId: string,
  actor: Actor,
  decision: "RETURN_THEN_REFUND" | "DISPUTE",
  reason: string,
  receiptId: string,
) {
  const policy = policyFor(s);
  const changes = [
    stmt(
      db,
      `UPDATE cases SET status='COMPLETED',decision=?,flags=?,reasons=?,missing_evidence=?,case_version=case_version+1,
 pending_evaluation_operation_id=NULL,updated_at=unixepoch() WHERE id=?`,
      decision,
      JSON.stringify(policy.flags),
      JSON.stringify(policy.reasons),
      JSON.stringify(policy.missingEvidence),
      s.case.id,
    ),
    stmt(
      db,
      `INSERT INTO receipts(id,case_id,operation_id,completion_mode,agent_run_id,decision,packet,reply) VALUES(?,?,?,'MANUAL',NULL,?,?,?)`,
      receiptId,
      s.case.id,
      operationId,
      decision,
      `SIMULATED ${decision} | order ${s.order.id} | owner-reviewed metadata`,
      `SIMULATED: Owner decision ${decision}. ${reason}`,
    ),
    event(db, s, operationId, "owner.decision", actor.id, {
      completionMode: "MANUAL",
      decision,
      reason,
      flags: policy.flags,
    }),
  ];
  return changes;
}
