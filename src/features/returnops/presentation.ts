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
  "case.intake": "Request received",
  "evidence.submitted": "Evidence reference added",
  "evidence.reviewed": "Evidence reviewed by owner",
  "owner.decision": "Owner decision saved",
  "evaluation.requested": "Evaluation requested",
  "evaluation.completed": "Evaluation completed",
  "evaluation.failed": "Evaluation incomplete",
};

export function timelinePresentation(e: Pick<TimelineEvent, "type" | "evaluationStatus">) {
  const evaluationEvent = e.type.startsWith("evaluation.") || !labels[e.type];
  const failed = e.type === "evaluation.failed" || evaluationEvent && e.evaluationStatus === "FAILED";
  const progress = e.type === "evaluation.requested" || evaluationEvent && (e.evaluationStatus === "PENDING" || e.evaluationStatus === "RUNNING");
  return {
    label: failed ? "Evaluation incomplete" : labels[e.type] || "Case updated",
    tone: failed ? "error" : progress ? "progress" : labels[e.type] ? "success" : "neutral",
  };
}
