import { z } from "zod";
import type { OrderSnapshot } from "../shared/contracts";
import type { PolicyResult } from "./policy";
import { ApiFault } from "./http";
export interface AgentContext {
  order: OrderSnapshot;
  claim: string;
  policy: PolicyResult;
}
const empty = z.object({}).strict();
const text = z.object({ text: z.string().trim().min(1).max(2000) }).strict();
const reason = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
export const toolNames = [
  "read_order",
  "check_policy",
  "list_missing_evidence",
  "draft_reply",
  "escalate",
] as const;
export const tools = toolNames.map((name) => ({
  type: "function",
  name,
  strict: true,
  description: {
    read_order: "Read canonical synthetic order facts.",
    check_policy: "Read deterministic policy outcome; never change it.",
    list_missing_evidence: "Read required current verified proof.",
    draft_reply: "Draft a short factual reply, always explicitly SIMULATED.",
    escalate: "Request owner review; cannot authorize completion.",
  }[name],
  parameters: {
    type: "object",
    properties:
      name === "draft_reply"
        ? { text: { type: "string" } }
        : name === "escalate"
          ? { reason: { type: "string" } }
          : {},
    required:
      name === "draft_reply" ? ["text"] : name === "escalate" ? ["reason"] : [],
    additionalProperties: false,
  },
}));
export function executeTool(
  name: string,
  input: unknown,
  context: AgentContext,
) {
  const schema =
    name === "draft_reply" ? text : name === "escalate" ? reason : empty;
  if (
    !(toolNames as readonly string[]).includes(name) ||
    !schema.safeParse(input).success
  )
    throw new ApiFault(
      503,
      "INVALID_TOOL_CALL",
      "Agent returned an invalid tool call",
    );
  switch (name) {
    case "read_order":
      return context.order;
    case "check_policy":
      return context.policy;
    case "list_missing_evidence":
      return context.policy.missingEvidence;
    case "draft_reply":
      return {
        mode: "SIMULATED",
        text: `SIMULATED: ${(input as { text: string }).text}`,
      };
    case "escalate":
      return {
        needsOwnerReview: true,
        reason: (input as { reason: string }).reason,
      };
  }
}
