import type {
  CaseQueueResponse,
  Evidence,
  OwnerDecisionResponse,
} from "../shared/contracts";
import { ApiFault, owner, type Actor } from "./http";
import {
  atomic,
  decode,
  detail,
  event,
  first,
  loadSnapshot,
  orderSnapshot,
  rows,
  ruleRow,
  snapshotCondition,
  stmt,
  type CaseRow,
  type Db,
  type OrderRow,
  type PolicyRow,
  type Snapshot,
} from "./db";
import { currentEvidence } from "./policy";
import {
  assertMutable,
  assertVersions,
  evaluationIntent,
  ownerCompletion,
  policyFor,
  type AgentRunner,
} from "./workflow";
import {
  decisionSchema,
  evaluateSchema,
  evidenceSchema,
  intakeSchema,
  reviewSchema,
} from "./validation";
import { acknowledgement, json, mutate, type BackendConfig } from "./mutations";
async function caseResource(db: Db, a: Actor, id: string) {
  return loadSnapshot(db, a.shopId, id);
}
function noCompleted(s: Snapshot) {
  assertMutable(s);
}
export async function handleCases(
  request: Request,
  db: Db,
  config: BackendConfig,
  a: Actor,
  segments: string[],
  url: URL,
  runner?: AgentRunner,
): Promise<Response> {
  const id = segments[2];
  if (!id && segments.length === 2 && request.method === "GET") {
    const allowed = new Set(["status", "cursor", "limit"]);
    for (const key of url.searchParams.keys())
      if (!allowed.has(key))
        throw new ApiFault(400, "INVALID_INPUT", "Unknown query");
    const limitValue = url.searchParams.get("limit") ?? "20";
    if (
      !/^\d+$/.test(limitValue) ||
      Number(limitValue) < 1 ||
      Number(limitValue) > 100
    )
      throw new ApiFault(400, "INVALID_INPUT", "Limit must be 1–100");
    const limit = Number(limitValue),
      status = url.searchParams.get("status");
    if (
      status &&
      ![
        "NEW",
        "WAITING_EVIDENCE",
        "NEEDS_OWNER_REVIEW",
        "COMPLETED",
        "TECHNICAL_ERROR",
      ].includes(status)
    )
      throw new ApiFault(400, "INVALID_INPUT", "Invalid status");
    let cursor: { at: number; id: string } | null = null;
    if (url.searchParams.has("cursor"))
      try {
        const raw = url.searchParams.get("cursor")!;
        if (raw.length > 512) throw Error();
        cursor = JSON.parse(atob(raw));
        if (
          !cursor ||
          !Number.isSafeInteger(cursor.at) ||
          typeof cursor.id !== "string" ||
          cursor.id.length > 128
        )
          throw Error();
      } catch {
        throw new ApiFault(400, "INVALID_CURSOR", "Invalid cursor");
      }
    let sql = "SELECT * FROM cases WHERE shop_id=?";
    const values: unknown[] = [a.shopId];
    if (status) {
      sql += " AND status=?";
      values.push(status);
    }
    if (cursor) {
      sql += " AND (updated_at<? OR (updated_at=? AND id<?))";
      values.push(cursor.at, cursor.at, cursor.id);
    }
    sql += " ORDER BY updated_at DESC,id DESC LIMIT ?";
    values.push(limit + 1);
    const found = await rows<CaseRow>(db, sql, ...values),
      items = found.slice(0, limit);
    const policy = await first<PolicyRow>(
      db,
      "SELECT * FROM shop_policy WHERE shop_id=?",
      a.shopId,
    );
    if (!policy)
      throw new ApiFault(
        503,
        "NOT_INITIALIZED",
        "Demo database not initialized",
      );
    const last = items.at(-1);
    const body: CaseQueueResponse = {
      items: items.map((c) => ({
        id: c.id,
        orderId: c.order_id,
        status: c.status,
        caseVersion: c.case_version,
        evidenceVersion: c.evidence_version,
        pendingEvaluationOperationId: c.pending_evaluation_operation_id,
        flags: decode(c.flags),
        updatedAt: c.updated_at,
      })),
      nextCursor:
        found.length > limit && last
          ? btoa(JSON.stringify({ at: last.updated_at, id: last.id }))
          : null,
      activeRulesVersion: policy.active_rules_version,
    };
    return json(body);
  }
  if (!id && segments.length === 2 && request.method === "POST")
    return await mutate(
      request,
      db,
      config,
      a,
      intakeSchema,
      "intake",
      "cases",
      async (m, body) => {
        const order = await first<OrderRow>(
          db,
          "SELECT * FROM orders WHERE id=? AND shop_id=?",
          body.orderId,
          a.shopId,
        );
        const policy = await first<PolicyRow>(
          db,
          "SELECT * FROM shop_policy WHERE shop_id=?",
          a.shopId,
        );
        if (!order) throw new ApiFault(404, "NOT_FOUND", "Order not found");
        if (!policy)
          throw new ApiFault(
            503,
            "NOT_INITIALIZED",
            "Demo database not initialized",
          );
        const rules = (
          await rows<Record<string, unknown>>(
            db,
            "SELECT * FROM rules WHERE shop_id=? ORDER BY id",
            a.shopId,
          )
        ).map(ruleRow);
        const now = Math.floor(Date.now() / 1000),
          caseId = crypto.randomUUID(),
          evalId = crypto.randomUUID();
        const c: CaseRow = {
          id: caseId,
          shop_id: a.shopId,
          order_id: order.id,
          claim: body.claim,
          case_version: 1,
          evidence_version: 0,
          status: "NEW",
          flags: "[]",
          reasons: "[]",
          missing_evidence: "[]",
          decision: null,
          applied_rule_id: null,
          applied_rule_version: null,
          source_case_id: null,
          pending_evaluation_operation_id: evalId,
          created_at: now,
          updated_at: now,
        };
        const proofs = await rows<{
          id: string;
          source: Evidence["source"];
          type: string;
          reference: string;
          review_status: Evidence["reviewStatus"];
        }>(db, "SELECT * FROM demo_proofs WHERE order_id=?", order.id);
        const evidence: Evidence[] = proofs.map((p) => ({
          id: crypto.randomUUID(),
          caseId,
          orderId: order.id,
          orderVersion: order.order_version,
          tracking: order.tracking,
          type: p.type,
          source: p.source,
          reference: p.reference,
          observedAt: now,
          evidenceVersion: 1,
          reviewStatus: p.review_status,
          verifiedBy:
            p.review_status === "VERIFIED" ? "demo-owner-review" : null,
          verifiedAt: p.review_status === "VERIFIED" ? now : null,
          reviewReason:
            p.review_status === "VERIFIED"
              ? "Seeded synthetic owner review"
              : null,
        }));
        c.evidence_version = evidence.length ? 1 : 0;
        const s: Snapshot = {
          case: c,
          order: orderSnapshot(order),
          evidence,
          rules,
          policy,
        };
        const response = { caseId, evaluationOperationId: evalId };
        const changes = [
          stmt(
            db,
            `INSERT INTO cases(id,shop_id,order_id,claim,case_version,evidence_version,status,pending_evaluation_operation_id,created_at,updated_at)
   VALUES(?,?,?,?,1,?,'NEW',?,unixepoch(),unixepoch())`,
            caseId,
            a.shopId,
            order.id,
            body.claim,
            c.evidence_version,
            evalId,
          ),
          acknowledgement(db, m, 201, response, caseId),
          evaluationIntent(db, s, evalId, m.id, 1),
          event(db, s, m.id, "case.intake", a.id, { orderId: order.id }),
        ];
        for (const e of evidence)
          changes.push(
            stmt(
              db,
              `INSERT INTO evidence(id,case_id,shop_id,order_id,order_version,tracking,type,source,reference,observed_at,evidence_version,review_status,verified_by,verified_at,review_reason)
   VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`,
              e.id,
              caseId,
              a.shopId,
              e.orderId,
              e.orderVersion,
              e.tracking,
              e.type,
              e.source,
              e.reference,
              e.observedAt,
              e.reviewStatus,
              e.verifiedBy,
              e.verifiedAt,
              e.reviewReason,
            ),
          );
        await atomic(
          db,
          `EXISTS(SELECT 1 FROM orders WHERE id=? AND shop_id=? AND order_version=?) AND EXISTS(SELECT 1 FROM shop_policy WHERE shop_id=? AND active_rules_version=? AND config_version=?)`,
          [
            order.id,
            a.shopId,
            order.order_version,
            a.shopId,
            policy.active_rules_version,
            policy.config_version,
          ],
          changes,
        );
        return { status: 201, body: response, evalId };
      },
      runner,
    );
  if (!id) throw new ApiFault(404, "NOT_FOUND", "Route not found");
  // Resource ownership is checked before any stored acknowledgement can be replayed.
  const s = await caseResource(db, a, id);
  if (segments.length === 3 && request.method === "GET")
    return json(await detail(db, a, id));
  if (request.method !== "POST")
    throw new ApiFault(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  if (segments.length === 4 && segments[3] === "evaluate")
    return await mutate(
      request,
      db,
      config,
      a,
      evaluateSchema,
      "evaluate",
      id,
      async (m, body) => {
        const fresh = await caseResource(db, a, id);
        noCompleted(fresh);
        assertVersions(
          fresh,
          body.expectedCaseVersion,
          body.expectedActiveRulesVersion,
        );
        if (
          fresh.case.pending_evaluation_operation_id &&
          (await first(
            db,
            "SELECT id FROM operations WHERE id=? AND (status='PENDING' OR (status='RUNNING' AND lease_until>unixepoch()))",
            fresh.case.pending_evaluation_operation_id,
          ))
        ) {
          throw new ApiFault(409, "CASE_BUSY", "Existing evaluation is active");
        }
        const evalId = crypto.randomUUID(),
          response = { caseId: id, operationId: evalId },
          g = snapshotCondition(fresh);
        // A concurrent lease takeover must not be superseded by a fresh intent.
        g.sql +=
          " AND NOT EXISTS(SELECT 1 FROM operations WHERE id=? AND (status='PENDING' OR (status='RUNNING' AND lease_until>unixepoch())))";
        g.values.push(fresh.case.pending_evaluation_operation_id);
        await atomic(db, g.sql, g.values, [
          acknowledgement(db, m, 202, response, id),
          stmt(
            db,
            "UPDATE cases SET case_version=case_version+1,pending_evaluation_operation_id=?,updated_at=unixepoch() WHERE id=?",
            evalId,
            id,
          ),
          evaluationIntent(
            db,
            fresh,
            evalId,
            m.id,
            fresh.case.case_version + 1,
          ),
          event(db, fresh, m.id, "evaluation.requested", a.id, {
            evaluationOperationId: evalId,
          }),
        ]);
        return { status: 202, body: response, evalId };
      },
      runner,
    );
  if (segments.length === 4 && segments[3] === "evidence")
    return await mutate(
      request,
      db,
      config,
      a,
      evidenceSchema,
      "submit-evidence",
      id,
      async (m, body) => {
        const fresh = await caseResource(db, a, id);
        noCompleted(fresh);
        assertVersions(fresh, body.expectedCaseVersion);
        if (body.observedAt > Math.floor(Date.now() / 1000))
          throw new ApiFault(
            400,
            "INVALID_INPUT",
            "Evidence observation time is in the future",
          );
        const evidenceId = crypto.randomUUID(),
          response = { evidenceId, evidenceVersion: 1 },
          g = snapshotCondition(fresh);
        await atomic(db, g.sql, g.values, [
          acknowledgement(db, m, 201, response, id),
          stmt(
            db,
            `INSERT INTO evidence(id,case_id,shop_id,order_id,order_version,tracking,type,source,reference,observed_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
            evidenceId,
            id,
            a.shopId,
            body.orderId,
            body.orderVersion,
            body.tracking,
            body.type,
            body.source,
            body.reference,
            body.observedAt,
          ),
          stmt(
            db,
            "UPDATE cases SET case_version=case_version+1,evidence_version=evidence_version+1,updated_at=unixepoch() WHERE id=?",
            id,
          ),
          event(db, fresh, m.id, "evidence.submitted", a.id, {
            evidenceId,
            type: body.type,
            source: body.source,
          }),
        ]);
        return { status: 201, body: response };
      },
      runner,
    );
  if (
    segments.length === 6 &&
    segments[3] === "evidence" &&
    segments[5] === "review"
  ) {
    owner(a);
    const eid = segments[4];
    if (!s.evidence.some((e) => e.id === eid))
      throw new ApiFault(404, "NOT_FOUND", "Evidence not found");
    return await mutate(
      request,
      db,
      config,
      a,
      reviewSchema,
      "review-evidence",
      `${id}/${eid}`,
      async (m, body) => {
        const fresh = await caseResource(db, a, id);
        noCompleted(fresh);
        assertVersions(fresh, body.expectedCaseVersion);
        const e = fresh.evidence.find((e) => e.id === eid);
        if (!e) throw new ApiFault(404, "NOT_FOUND", "Evidence not found");
        if (
          e.evidenceVersion !== body.expectedEvidenceVersion ||
          e.reviewStatus !== "SUBMITTED"
        )
          throw new ApiFault(
            409,
            "STALE_VERSION",
            "Evidence already reviewed or changed",
          );
        if (
          body.reviewStatus === "VERIFIED" &&
          (e.orderId !== fresh.order.id ||
            e.orderVersion !== fresh.order.orderVersion ||
            e.tracking !== fresh.order.tracking ||
            e.observedAt > Math.floor(Date.now() / 1000))
        )
          throw new ApiFault(
            409,
            "PROOF_CONTEXT_MISMATCH",
            "Proof does not match current order context",
          );
        const reviewed: Evidence = {
          ...e,
          reviewStatus: body.reviewStatus,
          evidenceVersion: e.evidenceVersion + 1,
          verifiedBy: body.reviewStatus === "VERIFIED" ? a.id : null,
          verifiedAt:
            body.reviewStatus === "VERIFIED"
              ? Math.floor(Date.now() / 1000)
              : null,
          reviewReason: body.reason,
        };
        const next = {
          ...fresh,
          case: {
            ...fresh.case,
            case_version: fresh.case.case_version + 1,
            evidence_version: fresh.case.evidence_version + 1,
          },
          evidence: fresh.evidence.map((item) =>
            item.id === eid ? reviewed : item,
          ),
        };
        const resume =
          body.reviewStatus === "VERIFIED" &&
          policyFor(next).status === "COMPLETED";
        const evalId = resume ? crypto.randomUUID() : null,
          response = {
            evidenceId: eid,
            reviewStatus: body.reviewStatus,
            evaluationOperationId: evalId,
          },
          g = snapshotCondition(fresh);
        g.sql +=
          " AND EXISTS(SELECT 1 FROM evidence WHERE id=? AND evidence_version=? AND review_status=?)";
        g.values.push(eid, e.evidenceVersion, "SUBMITTED");
        const changes = [
          acknowledgement(db, m, 200, response, id),
          stmt(
            db,
            `UPDATE evidence SET review_status=?,evidence_version=evidence_version+1,verified_by=?,verified_at=?,review_reason=? WHERE id=?`,
            reviewed.reviewStatus,
            reviewed.verifiedBy,
            reviewed.verifiedAt,
            reviewed.reviewReason,
            eid,
          ),
          stmt(
            db,
            "UPDATE cases SET case_version=case_version+1,evidence_version=evidence_version+1,pending_evaluation_operation_id=?,updated_at=unixepoch() WHERE id=?",
            evalId,
            id,
          ),
          event(db, fresh, m.id, "evidence.reviewed", a.id, {
            evidenceId: eid,
            reviewStatus: body.reviewStatus,
            evaluationOperationId: evalId,
          }),
        ];
        if (evalId)
          changes.push(
            evaluationIntent(db, next, evalId, m.id, next.case.case_version),
          );
        await atomic(db, g.sql, g.values, changes);
        return { status: 200, body: response, evalId: evalId ?? undefined };
      },
      runner,
    );
  }
  if (segments.length === 4 && segments[3] === "owner-decision") {
    owner(a);
    return await mutate(
      request,
      db,
      config,
      a,
      decisionSchema,
      "owner-decision",
      id,
      async (m, body) => {
        const fresh = await caseResource(db, a, id);
        noCompleted(fresh);
        assertVersions(
          fresh,
          body.expectedCaseVersion,
          body.expectedActiveRulesVersion,
        );
        const policy = policyFor(fresh);
        if (body.decision === "RETURN_THEN_REFUND" && !policy.monetaryEligible)
          throw new ApiFault(
            409,
            "POLICY_BLOCKED",
            "Current monetary guardrails are not satisfied",
          );
        if (
          body.decision === "DISPUTE" &&
          !currentEvidence(
            fresh.order,
            fresh.evidence,
            "CARRIER",
            "DELIVERY",
            Math.floor(Date.now() / 1000),
          )
        )
          throw new ApiFault(
            409,
            "PROOF_REQUIRED",
            "Current verified carrier delivery proof required",
          );
        const technical = !!(await first(
          db,
          "SELECT id FROM operations WHERE case_id=? AND shop_id=? AND kind='EVALUATION' AND status IN ('FAILED','PENDING','RUNNING') LIMIT 1",
          id,
          a.shopId,
        ));
        const eligible =
          body.decision === "RETURN_THEN_REFUND" &&
          !technical &&
          !decode<string[]>(fresh.case.reasons).includes("AGENT_ESCALATION") &&
          policy.monetaryEligible &&
          !policy.appliedRule &&
          fresh.order.reasonGroup === "FIT_ISSUE" &&
          fresh.order.itemCondition === "UNUSED_TAGS_INTACT";
        const suggestionId = eligible ? crypto.randomUUID() : null,
          receiptId = crypto.randomUUID();
        const receipt = {
          id: receiptId,
          mode: "SIMULATED" as const,
          completionMode: "MANUAL" as const,
          agentRunId: null,
          decision: body.decision,
          packet: `SIMULATED ${body.decision} | order ${fresh.order.id} | owner-reviewed metadata`,
          reply: `SIMULATED: Owner decision ${body.decision}. ${body.reason}`,
          appliedRuleId: null,
          appliedRuleVersion: null,
          sourceCaseId: null,
        };
        const response: OwnerDecisionResponse = {
          caseId: id,
          caseVersion: fresh.case.case_version + 1,
          status: "COMPLETED",
          decision: body.decision,
          receipt,
          suggestionId,
          activeRulesVersion: fresh.policy.active_rules_version,
        };
        const g = snapshotCondition(
          fresh,
          body.decision === "RETURN_THEN_REFUND",
        );
        if (suggestionId) {
          g.sql +=
            " AND NOT EXISTS(SELECT 1 FROM operations WHERE case_id=? AND shop_id=? AND kind='EVALUATION' AND status IN ('FAILED','PENDING','RUNNING'))";
          g.values.push(id, a.shopId);
        }
        const changes = [
          acknowledgement(db, m, 200, response, id),
          ...ownerCompletion(
            db,
            fresh,
            m.id,
            a,
            body.decision,
            body.reason,
            receiptId,
          ),
        ];
        if (suggestionId)
          changes.push(
            stmt(
              db,
              `INSERT INTO rule_suggestions(id,shop_id,source_case_id,source_snapshot,reason_group,item_condition,owner_reason) VALUES(?,?,?,?,?,?,?)`,
              suggestionId,
              a.shopId,
              id,
              JSON.stringify({
                caseVersion: fresh.case.case_version + 1,
                orderVersion: fresh.order.orderVersion,
                evidenceVersion: fresh.case.evidence_version,
                configVersion: fresh.policy.config_version,
                receiptId,
              }),
              fresh.order.reasonGroup,
              fresh.order.itemCondition,
              body.reason,
            ),
          );
        await atomic(db, g.sql, g.values, changes);
        return { status: 200, body: response };
      },
      runner,
    );
  }
  throw new ApiFault(404, "NOT_FOUND", "Route not found");
}
