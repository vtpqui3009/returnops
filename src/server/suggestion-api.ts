import type {
  AcceptSuggestionResponse,
  RejectSuggestionResponse,
  RuleSuggestionQueueResponse,
} from "../shared/contracts";
import { ApiFault, owner, type Actor } from "./http";
import {
  atomic,
  decode,
  event,
  first,
  loadSnapshot,
  ruleRow,
  snapshotCondition,
  stmt,
  suggestionRow,
  type Db,
  type PolicyRow,
} from "./db";
import { policyFor, type AgentRunner } from "./workflow";
import { acceptSchema, rejectSchema } from "./validation";
import { acknowledgement, json, mutate, type BackendConfig } from "./mutations";
export async function handleSuggestions(
  request: Request,
  db: Db,
  config: BackendConfig,
  a: Actor,
  segments: string[],
  url: URL,
  runner?: AgentRunner,
): Promise<Response> {
  if (segments.length === 2 && request.method === "GET") {
    for (const key of url.searchParams.keys())
      if (key !== "status")
        throw new ApiFault(400, "INVALID_INPUT", "Unknown query");
    const status = url.searchParams.get("status");
    if (status && !["PENDING", "ACCEPTED", "REJECTED"].includes(status))
      throw new ApiFault(400, "INVALID_INPUT", "Invalid suggestion status");
    const result = await db.batch<Record<string, unknown>>([
      stmt(db, `SELECT * FROM rule_suggestions WHERE shop_id=?${status ? " AND status=?" : ""} ORDER BY id`, ...(status ? [a.shopId, status] : [a.shopId])),
      stmt(db, "SELECT * FROM rules WHERE shop_id=? ORDER BY id", a.shopId),
      stmt(db, "SELECT * FROM shop_policy WHERE shop_id=?", a.shopId),
    ]);
    const suggestions = result[0].results;
    const rules = result[1].results;
    const policy = result[2].results[0] as unknown as PolicyRow | undefined;
    if (!policy)
      throw new ApiFault(503, "NOT_INITIALIZED", "Database not initialized");
    const response: RuleSuggestionQueueResponse = {
      suggestions: suggestions.map(suggestionRow),
      activeRules: rules.map(ruleRow),
      activeRulesVersion: policy.active_rules_version,
    };
    return json(response);
  }
  if (
    segments.length !== 4 ||
    request.method !== "POST" ||
    !["accept", "reject"].includes(segments[3])
  )
    throw new ApiFault(404, "NOT_FOUND", "Route not found");
  owner(a);
  const id = segments[2],
    action = segments[3];
  const suggestion = await first<Record<string, unknown>>(
    db,
    "SELECT * FROM rule_suggestions WHERE id=? AND shop_id=?",
    id,
    a.shopId,
  );
  if (!suggestion) throw new ApiFault(404, "NOT_FOUND", "Suggestion not found");
  if (action === "reject")
    return await mutate(
      request,
      db,
      config,
      a,
      rejectSchema,
      "reject-suggestion",
      id,
      async (m, body) => {
        const source = await loadSnapshot(
          db,
          a.shopId,
          String(suggestion.source_case_id),
        );
        const response: RejectSuggestionResponse = {
          suggestionId: id,
          suggestionVersion: body.expectedSuggestionVersion + 1,
          status: "REJECTED",
          activeRulesVersion: source.policy.active_rules_version,
        };
        await atomic(
          db,
          "EXISTS(SELECT 1 FROM rule_suggestions WHERE id=? AND shop_id=? AND suggestion_version=? AND status='PENDING')",
          [id, a.shopId, body.expectedSuggestionVersion],
          [
            acknowledgement(db, m, 200, response, source.case.id),
            stmt(
              db,
              "UPDATE rule_suggestions SET status='REJECTED',suggestion_version=suggestion_version+1 WHERE id=?",
              id,
            ),
            event(db, source, m.id, "suggestion.rejected", a.id, {
              suggestionId: id,
              reason: body.reason,
            }),
          ],
        );
        return { status: 200, body: response };
      },
      runner,
    );
  return await mutate(
    request,
    db,
    config,
    a,
    acceptSchema,
    "accept-suggestion",
    id,
    async (m, body) => {
      const source = await loadSnapshot(
        db,
        a.shopId,
        String(suggestion.source_case_id),
      );
      const provenance = decode<{
        caseVersion: number;
        orderVersion: number;
        evidenceVersion: number;
        configVersion: number;
        receiptId: string;
      }>(String(suggestion.source_snapshot));
      if (
        source.case.status !== "COMPLETED" ||
        source.case.decision !== "RETURN_THEN_REFUND" ||
        source.case.case_version !== provenance.caseVersion ||
        source.order.orderVersion !== provenance.orderVersion ||
        source.case.evidence_version !== provenance.evidenceVersion ||
        source.policy.config_version !== provenance.configVersion ||
        !policyFor(source).monetaryEligible ||
        source.order.reasonGroup !== "FIT_ISSUE" ||
        source.order.itemCondition !== "UNUSED_TAGS_INTACT"
      )
        throw new ApiFault(
          409,
          "SOURCE_NOT_ELIGIBLE",
          "Learning source no longer eligible",
        );
      if (
        source.policy.active_rules_version !== body.expectedActiveRulesVersion
      )
        throw new ApiFault(409, "STALE_VERSION", "Rule catalog changed");
      if (
        await first(
          db,
          "SELECT id FROM rules WHERE shop_id=? AND reason_group=? AND item_condition=? AND decision='RETURN_THEN_REFUND'",
          a.shopId,
          source.order.reasonGroup,
          source.order.itemCondition,
        )
      )
        throw new ApiFault(
          409,
          "RULE_ALREADY_ACTIVE",
          "Equivalent rule already active",
        );
      const ruleId = crypto.randomUUID(),
        response: AcceptSuggestionResponse = {
          suggestionId: id,
          suggestionVersion: body.expectedSuggestionVersion + 1,
          ruleId,
          activeRulesVersion: body.expectedActiveRulesVersion + 1,
        };
      const g = snapshotCondition(source, true);
      g.sql +=
        " AND NOT EXISTS(SELECT 1 FROM operations WHERE case_id=? AND shop_id=? AND kind='EVALUATION' AND status='FAILED')";
      g.values.push(source.case.id, a.shopId);
      g.sql +=
        " AND EXISTS(SELECT 1 FROM rule_suggestions WHERE id=? AND shop_id=? AND suggestion_version=? AND status='PENDING') AND EXISTS(SELECT 1 FROM receipts WHERE id=? AND case_id=? AND completion_mode='MANUAL' AND decision='RETURN_THEN_REFUND')";
      g.values.push(
        id,
        a.shopId,
        body.expectedSuggestionVersion,
        provenance.receiptId,
        source.case.id,
      );
      try {
        await atomic(db, g.sql, g.values, [
          acknowledgement(db, m, 200, response, source.case.id),
          stmt(
            db,
            "INSERT INTO rules(id,shop_id,version,source_case_id,decision,reason_group,item_condition) VALUES(?,?,?,?,'RETURN_THEN_REFUND',?,?)",
            ruleId,
            a.shopId,
            body.expectedActiveRulesVersion + 1,
            source.case.id,
            source.order.reasonGroup,
            source.order.itemCondition,
          ),
          stmt(
            db,
            "UPDATE rule_suggestions SET status='ACCEPTED',suggestion_version=suggestion_version+1,rule_id=? WHERE id=?",
            ruleId,
            id,
          ),
          stmt(
            db,
            "UPDATE shop_policy SET active_rules_version=active_rules_version+1 WHERE shop_id=?",
            a.shopId,
          ),
          event(db, source, m.id, "suggestion.accepted", a.id, {
            suggestionId: id,
            ruleId,
            activeRulesVersion: response.activeRulesVersion,
          }),
        ]);
      } catch (error) {
        if (String(error).includes("UNIQUE constraint failed: rules."))
          throw new ApiFault(
            409,
            "RULE_ALREADY_ACTIVE",
            "Equivalent rule already active",
          );
        throw error;
      }
      return { status: 200, body: response };
    },
    runner,
  );
}
