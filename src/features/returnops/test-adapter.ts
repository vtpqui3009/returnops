import type { CaseDetail, Evidence, RuleSuggestionQueueResponse, SimulatedReceipt } from "../../shared/contracts";
import { evaluationIsActive } from "./presentation";
import { currentVerifiedProof, RequestFailure, type Intent, type ReturnOpsApi } from "./api";

/** Isolated synthetic adapter, never a fallback for failed HTTP calls. Matches docs/scenarios.md. */
export interface TestStore { cases: Record<string, CaseDetail>; rules: RuleSuggestionQueueResponse; replay: Record<string, { hash: string; response: unknown }> }
const clock = () => Math.floor(Date.now() / 1000);
const clone = <T>(x: T): T => structuredClone(x);
const canonical = (x: unknown): string => x && typeof x === "object" ? Array.isArray(x) ? `[${x.map(canonical).join(",")}]` : `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonical((x as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(x) ?? "null";
export function seedTestStore(): TestStore {
  const claims = ["Shop giao nhầm kích cỡ áo", "Bình giữ nhiệt bị móp khi nhận", "Khách báo chưa nhận tai nghe", "Áo chưa dùng, còn tem nhưng không vừa", "Yêu cầu trả áo không vừa, đủ bằng chứng"];
  const amounts = [189000, 245000, 1250000, 199000, 279000];
  const cases: Record<string, CaseDetail> = {};
  for (const [i, letter] of ["a", "b", "c", "d", "e"].entries()) {
    const id = `demo-${letter}`;
    const c: CaseDetail = { id, order: { id, orderVersion: 1, amountVnd: amounts[i], deliveredAt: clock() - 86400, tracking: `trk-${letter}`, reasonGroup: i === 0 ? "SIZE_MISMATCH" : i === 1 ? "DAMAGE" : i === 2 ? "NOT_RECEIVED" : "FIT_ISSUE", itemCondition: i === 0 ? "WRONG_SIZE" : i === 1 ? "DAMAGED" : i === 2 ? "DELIVERY_CONFLICT" : "UNUSED_TAGS_INTACT" }, caseVersion: 1, evidenceVersion: 1, activeRulesVersion: 1, status: i === 0 ? "COMPLETED" : i === 1 ? "WAITING_EVIDENCE" : "NEEDS_OWNER_REVIEW", claim: claims[i], reasons: [], flags: i === 2 ? ["DELIVERY_CONFLICT", "REPEATED_COMPLAINTS", "OVER_HARD_CAP"] : [], missingEvidence: i === 1 ? ["SELLER_PACKING_PROOF"] : [], decision: null, appliedRuleId: null, appliedRuleVersion: null, sourceCaseId: null, pendingEvaluationOperationId: null, evaluation: null, evidence: [], timeline: [], receipt: null };
    if (i !== 1) c.evidence.push({ id: `proof-${letter}`, caseId: id, orderId: id, orderVersion: 1, tracking: c.order.tracking, type: i < 2 ? "PACKING" : i === 2 ? "DELIVERY" : "ITEM_CONDITION", source: i < 2 ? "SELLER" : i === 2 ? "CARRIER" : "BUYER", reference: `demo-proof-${letter}`, observedAt: clock(), evidenceVersion: 1, reviewStatus: i === 2 ? "SUBMITTED" : "VERIFIED", verifiedBy: i === 2 ? null : "test-owner", verifiedAt: i === 2 ? null : clock(), reviewReason: i === 2 ? null : "Đã đối chiếu trong dữ liệu TEST" });
    cases[id] = c;
  }
  const store: TestStore = { cases, rules: { suggestions: [], activeRules: [], activeRulesVersion: 1 }, replay: {} };
  complete(store.cases["demo-a"], "RETURN_THEN_REFUND", "AUTO");
  return store;
}
function complete(c: CaseDetail, decision: SimulatedReceipt["decision"], completionMode: "AUTO" | "MANUAL") {
  c.status = "COMPLETED"; c.decision = decision;
  c.receipt ??= { id: `receipt-${c.id}`, mode: "SIMULATED", completionMode, agentRunId: completionMode === "AUTO" ? `test-${c.id}` : null, decision, packet: `Hồ sơ mô phỏng cho ${c.id}. Không nộp sàn hay chuyển tiền.`, reply: "Shop đã ghi nhận yêu cầu và hướng xử lý. Đây là bản nháp, chưa gửi khách.", appliedRuleId: c.appliedRuleId, appliedRuleVersion: c.appliedRuleVersion, sourceCaseId: c.sourceCaseId };
}
export function createTestApi(store = seedTestStore(), save: (s: TestStore) => void = () => {}, delay = 200, role: "OWNER" | "MEMBER" = "OWNER"): ReturnOpsApi {
  const wait = async (signal?: AbortSignal) => { signal?.throwIfAborted(); await new Promise(r => setTimeout(r, delay)); signal?.throwIfAborted(); };
  const fail = (status: number, code: string) => { throw new RequestFailure(status, code, "Chưa thể thực hiện thao tác. Kiểm tra dữ liệu và thử lại nhé."); };
  const get = (id: string) => store.cases[id] || fail(404, "NOT_FOUND");
  const version = (actual: number, expected: number) => { if (actual !== expected) fail(409, "STALE_VERSION"); };
  const proofContext = (c: CaseDetail, e: Pick<Evidence, "orderId" | "orderVersion" | "tracking">) => { if (e.orderId !== c.order.id || e.orderVersion !== c.order.orderVersion || e.tracking !== c.order.tracking) fail(409, "PROOF_CONTEXT_MISMATCH"); };
  const moneyEligible = (c: CaseDetail) => c.order.amountVnd <= 300000 && c.order.deliveredAt !== null && c.order.deliveredAt <= clock() && clock() - c.order.deliveredAt <= 604800 && !c.flags.length && c.evidence.some(e => e.reviewStatus === "VERIFIED" && e.orderId === c.order.id && e.orderVersion === c.order.orderVersion && e.tracking === c.order.tracking);
  async function write<T, R>(scope: string, r: Intent<T>, action: () => R, owner = true, dispatch?: (response: R) => Promise<void>): Promise<R> {
    await wait(); if (owner && role !== "OWNER") fail(403, "FORBIDDEN");
    const key = `${role}:${scope}:${r.key}`, hash = canonical(r.body), replay = store.replay[key];
    if (replay) { if (replay.hash !== hash) fail(409, "IDEMPOTENCY_CONFLICT"); const response = clone(replay.response as R); await dispatch?.(response); return response; }
    const result = action(); store.replay[key] = { hash, response: clone(result) }; save(store); await dispatch?.(result); return clone(result);
  }
  const event = (c: CaseDetail, type: string) => { c.caseVersion++; c.timeline.push({ id: crypto.randomUUID(), type, actorId: "test-owner", occurredAt: clock(), evaluationStatus: type.startsWith("evaluation.") ? c.evaluation?.status || null : null, executionMode: "TEST", completionMode: c.receipt?.completionMode || null, details: {} }); };
  const start = (c: CaseDetail) => { const id = crypto.randomUUID(); c.pendingEvaluationOperationId = id; c.evaluation = { id, status: "PENDING", executionMode: "TEST", providerResponseId: null, model: null, error: null, result: null }; event(c, "evaluation.requested"); return id; };
  // POST dispatch owns progress. GET detail is a pure read, like the real API.
  async function dispatch(id: string, operationId: string | null) {
    const c = get(id);
    if (!operationId || c.evaluation?.id !== operationId || c.evaluation.status !== "PENDING") return;
    c.evaluation.status = "RUNNING";
    save(store);
    await wait();
    const rule = store.rules.activeRules.find(r => r.reasonGroup === c.order.reasonGroup && r.itemCondition === c.order.itemCondition);
    if (!c.receipt && moneyEligible(c) && (id === "demo-b" && currentVerifiedProof(c, "SELLER", "PACKING") || rule)) {
      if (rule) { c.appliedRuleId = rule.id; c.appliedRuleVersion = rule.version; c.sourceCaseId = rule.sourceCaseId; }
      complete(c, "RETURN_THEN_REFUND", "AUTO");
    }
    c.evaluation.status = "COMPLETED";
    c.evaluation.result = { status: c.status, decision: c.decision };
    c.pendingEvaluationOperationId = null;
    event(c, "evaluation.completed");
    save(store);
  }
  return {
    mode: "TEST",
    async queue(signal) { await wait(signal); return { items: Object.values(store.cases).map(c => ({ id: c.id, orderId: c.order.id, status: c.status, caseVersion: c.caseVersion, evidenceVersion: c.evidenceVersion, pendingEvaluationOperationId: c.pendingEvaluationOperationId, flags: c.flags, updatedAt: clock() })), nextCursor: null, activeRulesVersion: store.rules.activeRulesVersion }; },
    async detail(id, signal) { await wait(signal); return { ...clone(get(id)), activeRulesVersion: store.rules.activeRulesVersion }; },
    async rules(signal) { await wait(signal); return clone(store.rules); },
    evidence: (id, r) => write(`evidence:${id}`, r, () => { const c = get(id); version(c.caseVersion, r.body.expectedCaseVersion); proofContext(c, r.body); if (!r.body.reference.trim() || r.body.reference.length > 500 || !["SELLER", "BUYER", "CARRIER"].includes(r.body.source) || !["PACKING", "DELIVERY", "ITEM_CONDITION"].includes(r.body.type) || c.receipt) fail(400, "INVALID_EVIDENCE"); const e: Evidence = { ...r.body, id: crypto.randomUUID(), caseId: id, evidenceVersion: 1, reviewStatus: "SUBMITTED", verifiedBy: null, verifiedAt: null, reviewReason: null }; c.evidence.push(e); c.evidenceVersion++; event(c, "evidence.submitted"); return { evidenceId: e.id, evidenceVersion: e.evidenceVersion }; }, false),
    review: (id, eid, r) => write(`review:${id}:${eid}`, r, () => { const c = get(id), e = c.evidence.find(e => e.id === eid) || fail(404, "NOT_FOUND"); version(c.caseVersion, r.body.expectedCaseVersion); version(e.evidenceVersion, r.body.expectedEvidenceVersion); if (e.reviewStatus !== "SUBMITTED") fail(409, "STALE_VERSION"); proofContext(c, e); if (!r.body.reason.trim() || c.receipt) fail(400, "REVIEW_REASON_REQUIRED"); e.reviewStatus = r.body.reviewStatus; e.verifiedBy = r.body.reviewStatus === "VERIFIED" ? "test-owner" : null; e.verifiedAt = r.body.reviewStatus === "VERIFIED" ? clock() : null; e.reviewReason = r.body.reason; e.evidenceVersion++; c.evidenceVersion++; event(c, "evidence.reviewed"); const op = id === "demo-b" && currentVerifiedProof(c, "SELLER", "PACKING") ? start(c) : null; return { evidenceId: eid, reviewStatus: e.reviewStatus, evaluationOperationId: op }; }, true, response => dispatch(id, response.evaluationOperationId)),
    decide: (id, r) => write(`decide:${id}`, r, () => { const c = get(id); version(c.caseVersion, r.body.expectedCaseVersion); version(store.rules.activeRulesVersion, r.body.expectedActiveRulesVersion); if (!r.body.reason.trim() || c.receipt) fail(400, "INVALID_DECISION"); if (r.body.decision === "DISPUTE" ? !currentVerifiedProof(c, "CARRIER", "DELIVERY") : !moneyEligible(c)) fail(409, "PROOF_REQUIRED"); complete(c, r.body.decision, "MANUAL"); let suggestionId: string | null = null; if (id === "demo-d" && r.body.decision === "RETURN_THEN_REFUND") { suggestionId = crypto.randomUUID(); store.rules.suggestions.push({ id: suggestionId, sourceCaseId: id, suggestionVersion: 1, status: "PENDING", decision: "RETURN_THEN_REFUND", reasonGroup: c.order.reasonGroup, itemCondition: c.order.itemCondition, ownerReason: r.body.reason, ruleId: null }); } event(c, "owner.decision"); return { caseId: id, caseVersion: c.caseVersion, status: "COMPLETED" as const, decision: r.body.decision, receipt: c.receipt!, suggestionId, activeRulesVersion: store.rules.activeRulesVersion }; }),
    accept: (id, r) => write(`accept:${id}`, r, () => { const suggestion = store.rules.suggestions.find(s => s.id === id) || fail(404, "NOT_FOUND"); version(suggestion.suggestionVersion, r.body.expectedSuggestionVersion); version(store.rules.activeRulesVersion, r.body.expectedActiveRulesVersion); if (suggestion.status !== "PENDING") fail(409, "STALE_VERSION"); suggestion.status = "ACCEPTED"; suggestion.suggestionVersion++; suggestion.ruleId = crypto.randomUUID(); store.rules.activeRulesVersion++; store.rules.activeRules.push({ id: suggestion.ruleId, version: store.rules.activeRulesVersion, sourceCaseId: suggestion.sourceCaseId, decision: "RETURN_THEN_REFUND", reasonGroup: suggestion.reasonGroup, itemCondition: suggestion.itemCondition }); return { suggestionId: id, suggestionVersion: suggestion.suggestionVersion, ruleId: suggestion.ruleId, activeRulesVersion: store.rules.activeRulesVersion }; }),
    reject: (id, r) => write(`reject:${id}`, r, () => { const s = store.rules.suggestions.find(s => s.id === id) || fail(404, "NOT_FOUND"); version(s.suggestionVersion, r.body.expectedSuggestionVersion); if (!r.body.reason.trim() || s.status !== "PENDING") fail(400, "INVALID_REJECTION"); s.status = "REJECTED"; s.suggestionVersion++; return { suggestionId: id, suggestionVersion: s.suggestionVersion, status: "REJECTED" as const, activeRulesVersion: store.rules.activeRulesVersion }; }),
    evaluate: (id, r) => write(`evaluate:${id}`, r, () => { const c = get(id); version(c.caseVersion, r.body.expectedCaseVersion); version(store.rules.activeRulesVersion, r.body.expectedActiveRulesVersion); if (evaluationIsActive(c)) fail(409, "CASE_BUSY"); return { caseId: id, operationId: start(c) }; }, false, response => dispatch(id, response.operationId)),
  };
}

export function browserTestApi(): ReturnOpsApi {
  const key = "returnops-test-fixtures-v1";
  // Session-only TEST fixtures. Production API mode never reads browser storage.
  let store: TestStore;
  try { const saved = sessionStorage.getItem(key); store = saved ? JSON.parse(saved) : seedTestStore(); if (!store.cases || !store.rules || !store.replay) throw Error(); }
  catch { throw new RequestFailure(0, "TEST_STORAGE", "Chưa đọc được dữ liệu TEST trong phiên này. Không có dữ liệu thật bị thay đổi."); }
  return createTestApi(store, s => { sessionStorage.setItem(key, JSON.stringify(s)); });
}
