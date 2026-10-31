import type { CaseDetail, TimelineEvent } from "../../shared/contracts";

/** A retained pointer can name a terminal operation after a snapshot-fence failure.
 * An older terminal operation cannot clear a different, still-pending pointer. */
export function evaluationIsActive(c: CaseDetail) {
  const id = c.pendingEvaluationOperationId;
  return !!id && (c.evaluation?.id !== id || c.evaluation.status === "PENDING" || c.evaluation.status === "RUNNING");
}

export function evaluationHasFailed(c: CaseDetail) {
  return c.evaluation?.status === "FAILED" && (!c.pendingEvaluationOperationId || c.pendingEvaluationOperationId === c.evaluation.id);
}

const labels: Record<string, string> = {
  "case.intake": "Đã tiếp nhận yêu cầu",
  "evidence.submitted": "Đã thêm tham chiếu bằng chứng",
  "evidence.reviewed": "Chủ shop đã xem xét bằng chứng",
  "owner.decision": "Đã lưu quyết định của chủ shop",
  "evaluation.requested": "Đã yêu cầu đánh giá",
  "evaluation.completed": "Đã hoàn tất đánh giá",
  "evaluation.failed": "Đánh giá chưa hoàn tất",
};

export function timelinePresentation(e: Pick<TimelineEvent, "type" | "evaluationStatus">) {
  const evaluationEvent = e.type.startsWith("evaluation.") || !labels[e.type];
  const failed = e.type === "evaluation.failed" || evaluationEvent && e.evaluationStatus === "FAILED";
  const progress = e.type === "evaluation.requested" || evaluationEvent && (e.evaluationStatus === "PENDING" || e.evaluationStatus === "RUNNING");
  return {
    label: failed ? "Đánh giá chưa hoàn tất" : labels[e.type] || "Cập nhật hồ sơ",
    tone: failed ? "error" : progress ? "progress" : labels[e.type] ? "success" : "neutral",
  };
}
