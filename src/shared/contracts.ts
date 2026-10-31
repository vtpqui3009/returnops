/** Shared wire contract proposal. The team must approve it before UI/API lanes split. */
export type Decision =
  | "REFUND_NOW"
  | "RETURN_THEN_REFUND"
  | "PARTIAL_REFUND"
  | "DISPUTE";

/** Owner actions approved for this baseline proposal. Other enum values remain reserved. */
export type OwnerDecision = "RETURN_THEN_REFUND" | "DISPUTE";

export type CaseStatus =
  | "NEW"
  | "WAITING_EVIDENCE"
  | "NEEDS_OWNER_REVIEW"
  | "COMPLETED"
  | "TECHNICAL_ERROR";

export type EvidenceSource = "SELLER" | "BUYER" | "CARRIER";
export type EvidenceReviewStatus = "SUBMITTED" | "VERIFIED" | "REJECTED";
export type EvaluationStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
export type ExecutionMode = "LIVE" | "TEST" | "REPLAY";
export type CompletionMode = "AUTO" | "MANUAL";
export type SuggestionStatus = "PENDING" | "ACCEPTED" | "REJECTED";
export type RiskFlag =
  | "DELIVERY_CONFLICT"
  | "REPEATED_COMPLAINTS"
  | "OVER_HARD_CAP";

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    requestId: string;
  };
}

export interface OrderSnapshot {
  id: string;
  orderVersion: number;
  amountVnd: number;
  deliveredAt: number;
  tracking: string;
  reasonGroup: string;
  itemCondition: string;
}

export interface Evidence {
  id: string;
  caseId: string;
  orderId: string;
  orderVersion: number;
  tracking: string;
  type: string;
  source: EvidenceSource;
  reference: string;
  observedAt: number;
  evidenceVersion: number;
  reviewStatus: EvidenceReviewStatus;
  verifiedBy: string | null;
  verifiedAt: number | null;
  reviewReason: string | null;
}

export interface EvaluationOperation {
  id: string;
  status: EvaluationStatus;
  executionMode: ExecutionMode | null;
  providerResponseId: string | null;
  model: string | null;
  error: { code: string; message: string } | null;
  result: { status: CaseStatus; decision: Decision | null } | null;
}

export interface SimulatedReceipt {
  id: string;
  mode: "SIMULATED";
  completionMode: CompletionMode;
  agentRunId: string | null;
  decision: Decision;
  packet: string;
  reply: string;
  appliedRuleId: string | null;
  appliedRuleVersion: number | null;
  sourceCaseId: string | null;
}

export interface TimelineEvent {
  id: string;
  type: string;
  actorId: string | null;
  occurredAt: number;
  evaluationStatus: EvaluationStatus | null;
  executionMode: ExecutionMode | null;
  completionMode: CompletionMode | null;
  details: Record<string, unknown>;
}

export interface CaseDetail {
  id: string;
  order: OrderSnapshot;
  caseVersion: number;
  evidenceVersion: number;
  activeRulesVersion: number;
  status: CaseStatus;
  claim: string;
  reasons: string[];
  flags: RiskFlag[];
  missingEvidence: string[];
  decision: Decision | null;
  appliedRuleId: string | null;
  appliedRuleVersion: number | null;
  sourceCaseId: string | null;
  pendingEvaluationOperationId: string | null;
  evaluation: EvaluationOperation | null;
  evidence: Evidence[];
  timeline: TimelineEvent[];
  receipt: SimulatedReceipt | null;
}

export interface CaseQueueItem {
  id: string;
  orderId: string;
  status: CaseStatus;
  caseVersion: number;
  evidenceVersion: number;
  pendingEvaluationOperationId: string | null;
  flags: RiskFlag[];
  updatedAt: number;
}

export interface CaseQueueResponse {
  items: CaseQueueItem[];
  nextCursor: string | null;
  activeRulesVersion: number;
}

export interface RuleSuggestion {
  id: string;
  sourceCaseId: string;
  suggestionVersion: number;
  status: SuggestionStatus;
  decision: "RETURN_THEN_REFUND";
  reasonGroup: string;
  itemCondition: string;
  ownerReason: string;
  ruleId: string | null;
}

export interface ActiveRule {
  id: string;
  version: number;
  sourceCaseId: string | null;
  decision: "RETURN_THEN_REFUND";
  reasonGroup: string;
  itemCondition: string;
}

export interface RuleSuggestionQueueResponse {
  suggestions: RuleSuggestion[];
  activeRules: ActiveRule[];
  activeRulesVersion: number;
}

export interface IntakeRequest {
  orderId: string;
  claim: string;
}

export interface EvaluateRequest {
  expectedCaseVersion: number;
  expectedActiveRulesVersion: number;
}

export interface SubmitEvidenceRequest {
  expectedCaseVersion: number;
  orderId: string;
  orderVersion: number;
  tracking: string;
  type: string;
  source: EvidenceSource;
  reference: string;
  observedAt: number;
}

export interface ReviewEvidenceRequest {
  expectedCaseVersion: number;
  expectedEvidenceVersion: number;
  reviewStatus: "VERIFIED" | "REJECTED";
  reason: string;
}

export interface OwnerDecisionRequest {
  expectedCaseVersion: number;
  expectedActiveRulesVersion: number;
  decision: OwnerDecision;
  reason: string;
}

export interface AcceptSuggestionRequest {
  expectedSuggestionVersion: number;
  expectedActiveRulesVersion: number;
}

export interface RejectSuggestionRequest {
  expectedSuggestionVersion: number;
  reason: string;
}

export interface IntakeAcknowledgement {
  caseId: string;
  evaluationOperationId: string;
}

export interface EvaluateAcknowledgement {
  caseId: string;
  operationId: string;
}

export interface EvidenceAcknowledgement {
  evidenceId: string;
  evidenceVersion: number;
}

export interface ReviewAcknowledgement {
  evidenceId: string;
  reviewStatus: EvidenceReviewStatus;
  evaluationOperationId: string | null;
}

export interface OwnerDecisionResponse {
  caseId: string;
  caseVersion: number;
  status: "COMPLETED";
  decision: Decision;
  receipt: SimulatedReceipt;
  suggestionId: string | null;
  activeRulesVersion: number;
}

export interface AcceptSuggestionResponse {
  suggestionId: string;
  suggestionVersion: number;
  ruleId: string;
  activeRulesVersion: number;
}

export interface RejectSuggestionResponse {
  suggestionId: string;
  suggestionVersion: number;
  status: "REJECTED";
  activeRulesVersion: number;
}
