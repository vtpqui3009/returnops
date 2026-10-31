import type { AcceptSuggestionRequest, AcceptSuggestionResponse, CaseDetail, CaseQueueResponse, Evidence, EvidenceAcknowledgement, EvaluateAcknowledgement, EvaluateRequest, OwnerDecisionRequest, OwnerDecisionResponse, RejectSuggestionRequest, RejectSuggestionResponse, ReviewAcknowledgement, ReviewEvidenceRequest, RuleSuggestionQueueResponse, SubmitEvidenceRequest } from "../../shared/contracts";

export class RequestFailure extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string) { super(message); this.name = "RequestFailure"; }
}
export interface Intent<T> { key: string; body: T }
export const intent = <T>(body: T): Intent<T> => ({ key: crypto.randomUUID(), body: structuredClone(body) });
export interface ReturnOpsApi {
  mode: "API" | "TEST";
  queue(signal?: AbortSignal, cursor?: string): Promise<CaseQueueResponse>;
  detail(id: string, signal?: AbortSignal): Promise<CaseDetail>;
  rules(signal?: AbortSignal): Promise<RuleSuggestionQueueResponse>;
  evidence(id: string, request: Intent<SubmitEvidenceRequest>): Promise<EvidenceAcknowledgement>;
  review(id: string, eid: string, request: Intent<ReviewEvidenceRequest>): Promise<ReviewAcknowledgement>;
  decide(id: string, request: Intent<OwnerDecisionRequest>): Promise<OwnerDecisionResponse>;
  accept(id: string, request: Intent<AcceptSuggestionRequest>): Promise<AcceptSuggestionResponse>;
  reject(id: string, request: Intent<RejectSuggestionRequest>): Promise<RejectSuggestionResponse>;
  evaluate(id: string, request: Intent<EvaluateRequest>): Promise<EvaluateAcknowledgement>;
  resetDemo?(request: Intent<{ confirm: "reset-shared-demo" }>): Promise<{ reset: true; caseCount: number }>;
}

export function createHttpApi(fetcher: typeof fetch = fetch): ReturnOpsApi {
  type RecordValue = Record<string, unknown>;
  const object = (x: unknown): x is RecordValue => !!x && typeof x === "object" && !Array.isArray(x);
  const text = (x: unknown) => typeof x === "string";
  const positive = (x: unknown) => Number.isInteger(x) && Number(x) > 0;
  const strings = (x: unknown) => Array.isArray(x) && x.every(text);
  const status = (x: unknown) => ["NEW", "WAITING_EVIDENCE", "NEEDS_OWNER_REVIEW", "COMPLETED", "TECHNICAL_ERROR"].includes(String(x));
  const receipt = (x: unknown) => object(x) && x.mode === "SIMULATED" && text(x.id) && text(x.packet) && text(x.reply) && ["AUTO", "MANUAL"].includes(String(x.completionMode));
  const detail = (x: unknown) => object(x) && text(x.id) && object(x.order) && text(x.order.id) && text(x.order.tracking) && positive(x.order.orderVersion) && Number.isInteger(x.order.amountVnd) && (x.order.deliveredAt === null || typeof x.order.deliveredAt === "number") && status(x.status) && text(x.claim) && strings(x.flags) && strings(x.reasons) && positive(x.caseVersion) && positive(x.activeRulesVersion) && Array.isArray(x.evidence) && x.evidence.every(e => object(e) && text(e.id) && text(e.reference) && text(e.orderId) && text(e.tracking) && positive(e.orderVersion) && positive(e.evidenceVersion) && ["SUBMITTED", "VERIFIED", "REJECTED"].includes(String(e.reviewStatus))) && Array.isArray(x.timeline) && x.timeline.every(e => object(e) && text(e.id) && text(e.type) && typeof e.occurredAt === "number") && (x.receipt === null || receipt(x.receipt)) && (x.evaluation === null || object(x.evaluation) && text(x.evaluation.id) && ["PENDING", "RUNNING", "COMPLETED", "FAILED"].includes(String(x.evaluation.status)));
  const queue = (x: unknown) => object(x) && positive(x.activeRulesVersion) && (x.nextCursor === null || text(x.nextCursor)) && Array.isArray(x.items) && x.items.every(i => object(i) && text(i.id) && text(i.orderId) && status(i.status));
  const rules = (x: unknown) => object(x) && positive(x.activeRulesVersion) && Array.isArray(x.suggestions) && x.suggestions.every(s => object(s) && text(s.id) && text(s.sourceCaseId) && positive(s.suggestionVersion) && text(s.ownerReason) && text(s.reasonGroup) && text(s.itemCondition) && ["PENDING", "ACCEPTED", "REJECTED"].includes(String(s.status))) && Array.isArray(x.activeRules) && x.activeRules.every(r => object(r) && text(r.id) && positive(r.version));
  const ack = (keys: string[], numbers: string[] = []) => (x: unknown) => object(x) && keys.every(k => text(x[k])) && numbers.every(k => positive(x[k]));
  async function read<T>(path: string, options: RequestInit, valid: (x: unknown) => boolean): Promise<T> {
    let response: Response;
    try { response = await fetcher(path, { ...options, credentials: "same-origin", cache: "no-store" }); }
    catch (error) { if (error instanceof Error && error.name === "AbortError") throw error; throw new RequestFailure(0, "NETWORK", "Chưa kết nối được. Bạn thử lại nhé."); }
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const failure = object(json) && object(json.error) ? json.error : {};
      throw new RequestFailure(response.status, text(failure.code) ? String(failure.code) : "HTTP_ERROR", text(failure.message) ? String(failure.message) : "Chưa đọc được dữ liệu.", text(failure.requestId) ? String(failure.requestId) : undefined);
    }
    if (!valid(json)) throw new RequestFailure(502, "INVALID_RESPONSE", "Dữ liệu trả về chưa đúng định dạng. Chưa thể xác nhận thao tác thành công.");
    return json as T;
  }
  const post = <T, R>(path: string, request: Intent<T>, valid: (x: unknown) => boolean) => read<R>(path, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": request.key }, body: JSON.stringify(request.body) }, valid);
  const path = (id: string) => `/api/cases/${encodeURIComponent(id)}`;
  return {
    mode: "API",
    queue: (signal, cursor) => read(`/api/cases?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal }, queue),
    detail: (id, signal) => read(path(id), { signal }, detail),
    rules: signal => read("/api/rule-suggestions", { signal }, rules),
    evidence: (id, r) => post(`${path(id)}/evidence`, r, ack(["evidenceId"], ["evidenceVersion"])),
    review: (id, eid, r) => post(`${path(id)}/evidence/${encodeURIComponent(eid)}/review`, r, x => object(x) && ack(["evidenceId", "reviewStatus"])(x) && (x.evaluationOperationId === null || text(x.evaluationOperationId))),
    decide: (id, r) => post(`${path(id)}/owner-decision`, r, x => object(x) && ack(["caseId", "decision"], ["caseVersion", "activeRulesVersion"])(x) && x.status === "COMPLETED" && receipt(x.receipt)),
    accept: (id, r) => post(`/api/rule-suggestions/${encodeURIComponent(id)}/accept`, r, ack(["suggestionId", "ruleId"], ["suggestionVersion", "activeRulesVersion"])),
    reject: (id, r) => post(`/api/rule-suggestions/${encodeURIComponent(id)}/reject`, r, x => object(x) && x.status === "REJECTED" && ack(["suggestionId"], ["suggestionVersion", "activeRulesVersion"])(x)),
    evaluate: (id, r) => post(`${path(id)}/evaluate`, r, ack(["caseId", "operationId"])),
    resetDemo: r => post("/api/demo/reset", r, x => object(x) && x.reset === true && x.caseCount === 5),
  };
}

/** Display-only gate. The API must independently enforce current evidence and authorization. */
export function evidenceIsCurrent(c: CaseDetail, e: Evidence) {
  return e.caseId === c.id && e.orderId === c.order.id && e.orderVersion === c.order.orderVersion && e.tracking === c.order.tracking;
}
export function currentVerifiedProof(c: CaseDetail, source: "SELLER" | "CARRIER", type: string) {
  return c.evidence.some(e => evidenceIsCurrent(c, e) && e.source === source && e.type === type && e.reviewStatus === "VERIFIED" && !!e.verifiedBy && e.verifiedAt !== null && e.verifiedAt > 0);
}
export function friendlyError(error: unknown) {
  if (!(error instanceof RequestFailure)) return "Chưa hoàn tất thao tác. Dữ liệu bạn nhập vẫn được giữ; thử lại nhé.";
  if (error.status === 401) return "Phiên đăng nhập chưa sẵn sàng. Đăng nhập lại rồi tải lại mục này nhé.";
  if (error.status === 403) return "Thao tác này cần quyền chủ shop. Bạn nhờ chủ shop kiểm tra quyền nhé.";
  if (error.code === "PROOF_CONTEXT_MISMATCH") return "Bằng chứng chưa khớp đơn hoặc vận đơn hiện hành. Tải lại yêu cầu và kiểm tra thông tin nhé.";
  if (error.status === 409) return "Thông tin đã thay đổi. Tải bản mới và xem lại trước khi xác nhận nhé.";
  if (error.status === 404) return "Chưa tìm thấy dữ liệu cho mục này. API có thể chưa sẵn sàng; chưa có thay đổi nào được lưu.";
  if (error.code === "EVALUATION_FAILED") return "Đánh giá chưa hoàn tất. Chưa xử lý thành công yêu cầu này; bạn có thể chọn đánh giá lại bằng dữ liệu mới.";
  if (error.status >= 500 && error.code !== "INVALID_RESPONSE") return "Chưa nhận được kết quả xác nhận. Dữ liệu bạn nhập vẫn được giữ; bạn có thể thử lại cùng thao tác nhé.";
  return error.message;
}

export async function pollEvaluation(api: ReturnOpsApi, id: string, operationId: string, signal: AbortSignal, interval = 800, timeout = 30_000, onUpdate?: (c: CaseDetail) => void): Promise<CaseDetail> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const c = await api.detail(id, signal);
    signal.throwIfAborted();
    if (c.evaluation?.id === operationId) {
      onUpdate?.(c);
      if (c.evaluation.status === "FAILED") throw new RequestFailure(502, "EVALUATION_FAILED", "Đánh giá chưa hoàn tất.");
      if (c.evaluation.status === "COMPLETED") return c;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, interval);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }
  throw new RequestFailure(408, "POLL_TIMEOUT", "Chưa có kết quả sau thời gian chờ. Bạn có thể thử lại thao tác đã xác nhận để tiếp tục theo dõi.");
}

interface PollOptions { interval?: number; timeout?: number }

/** Each deliberate retry replays the same POST so the server can recover dispatch.
 * GET polling never drives work, and a retry never creates a fresh intent. */
export function evaluationJob(api: ReturnOpsApi, id: string, onUpdate?: (c: CaseDetail) => void, options: PollOptions = {}) {
  let request: Intent<EvaluateRequest> | undefined;
  return async (signal: AbortSignal) => {
    if (!request) { const c = await api.detail(id, signal); request = intent({ expectedCaseVersion: c.caseVersion, expectedActiveRulesVersion: c.activeRulesVersion }); }
    signal.throwIfAborted();
    const acknowledged = await api.evaluate(id, request);
    return pollEvaluation(api, id, acknowledged.operationId, signal, options.interval ?? 800, options.timeout ?? 30_000, onUpdate);
  };
}

export function evidenceReviewJob(api: ReturnOpsApi, id: string, evidenceId: string, request: Intent<ReviewEvidenceRequest>, onUpdate?: (c: CaseDetail) => void, options: PollOptions = {}) {
  return async (signal: AbortSignal) => {
    signal.throwIfAborted();
    const acknowledged = await api.review(id, evidenceId, request);
    return acknowledged.evaluationOperationId
      ? pollEvaluation(api, id, acknowledged.evaluationOperationId, signal, options.interval ?? 800, options.timeout ?? 30_000, onUpdate)
      : api.detail(id, signal);
  };
}
