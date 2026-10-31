import type {
  ActiveRule,
  CaseStatus,
  Decision,
  Evidence,
  OrderSnapshot,
  RiskFlag,
} from "../shared/contracts";

export interface PolicyResult {
  status: CaseStatus;
  decision: Decision | null;
  reasons: string[];
  flags: RiskFlag[];
  missingEvidence: string[];
  appliedRule: ActiveRule | null;
  monetaryEligible: boolean;
  currentProof: boolean;
}

/** Only current owner-verified metadata is evidence; claims never alter order facts. */
export function currentEvidence(
  order: OrderSnapshot,
  evidence: Evidence[],
  source: string,
  type: string,
  now: number,
) {
  return evidence.some(
    (e) =>
      e.orderId === order.id &&
      e.orderVersion === order.orderVersion &&
      e.tracking === order.tracking &&
      e.source === source &&
      e.type === type &&
      e.reviewStatus === "VERIFIED" &&
      !!e.verifiedBy &&
      e.verifiedAt !== null &&
      e.verifiedAt <= now &&
      Number.isInteger(e.observedAt) &&
      e.observedAt >= 0 &&
      e.observedAt <= now,
  );
}

export function evaluatePolicy(
  order: OrderSnapshot & { riskFlags: RiskFlag[] },
  evidence: Evidence[],
  rules: ActiveRule[],
  now: number,
  config = { hardCapVnd: 300000, windowSeconds: 604800 },
): PolicyResult {
  const flags = [...new Set(order.riskFlags)];
  if (
    order.amountVnd > Math.min(config.hardCapVnd, 300000) &&
    !flags.includes("OVER_HARD_CAP")
  )
    flags.push("OVER_HARD_CAP");
  const reasons: string[] = [];
  const validMoney =
    Number.isSafeInteger(order.amountVnd) &&
    order.amountVnd > 0 &&
    Number.isSafeInteger(config.hardCapVnd) &&
    config.hardCapVnd > 0 &&
    order.amountVnd <= Math.min(config.hardCapVnd, 300000);
  const validWindow =
    Number.isInteger(order.deliveredAt) &&
    order.deliveredAt !== null &&
    Number.isSafeInteger(config.windowSeconds) &&
    config.windowSeconds > 0 &&
    order.deliveredAt <= now &&
    now <= order.deliveredAt + Math.min(config.windowSeconds, 604800);
  if (!validMoney) reasons.push("HARD_CAP");
  if (!validWindow) reasons.push("OUTSIDE_POLICY_WINDOW");
  if (flags.length) reasons.push(...flags);
  const fit =
    order.reasonGroup === "FIT_ISSUE" &&
    order.itemCondition === "UNUSED_TAGS_INTACT";
  const size =
    order.reasonGroup === "SIZE_MISMATCH" &&
    order.itemCondition === "WRONG_SIZE";
  const damage =
    order.reasonGroup === "DAMAGE" && order.itemCondition === "DAMAGED";
  const dispute = order.reasonGroup === "DENIED_RECEIPT";
  const proof = dispute
    ? currentEvidence(order, evidence, "CARRIER", "DELIVERY", now)
    : fit
    ? currentEvidence(order, evidence, "BUYER", "ITEM_CONDITION", now)
    : currentEvidence(order, evidence, "SELLER", "PACKING", now);
  const missingEvidence = proof
    ? []
    : [dispute ? "CARRIER_DELIVERY_PROOF" : fit ? "BUYER_ITEM_CONDITION_PROOF" : "SELLER_PACKING_PROOF"];
  const monetaryEligible =
    validMoney &&
    validWindow &&
    !flags.length &&
    proof &&
    (fit || size || damage);
  const appliedRule =
    rules.find(
      (rule) =>
        rule.decision === "RETURN_THEN_REFUND" &&
        rule.reasonGroup === order.reasonGroup &&
        rule.itemCondition === order.itemCondition &&
        // Learned rules generalize only the approved fit predicate.
        (rule.sourceCaseId === null ? size || damage : fit),
    ) ?? null;
  if (reasons.length)
    return {
      status: "NEEDS_OWNER_REVIEW",
      decision: null,
      reasons,
      flags,
      missingEvidence,
      appliedRule: null,
      monetaryEligible: false,
      currentProof: proof,
    };
  if (!proof)
    return {
      status: "WAITING_EVIDENCE",
      decision: null,
      reasons: ["CURRENT_VERIFIED_PROOF_REQUIRED"],
      flags,
      missingEvidence,
      appliedRule: null,
      monetaryEligible: false,
      currentProof: false,
    };
  if (!monetaryEligible || !appliedRule)
    return {
      status: "NEEDS_OWNER_REVIEW",
      decision: null,
      reasons: ["OWNER_REVIEW_REQUIRED"],
      flags,
      missingEvidence,
      appliedRule: null,
      monetaryEligible,
      currentProof: proof,
    };
  return {
    status: "COMPLETED",
    decision: "RETURN_THEN_REFUND",
    reasons: ["APPROVED_RULE"],
    flags,
    missingEvidence,
    appliedRule,
    monetaryEligible,
    currentProof: proof,
  };
}
