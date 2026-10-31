import { z } from "zod";
const version = z.number().int().positive().safe();
const text = z.string().trim().min(1).max(500);
const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const intakeSchema = z
  .object({ orderId: identifier, claim: z.string().trim().min(1).max(2000) })
  .strict();
export const evaluateSchema = z
  .object({ expectedCaseVersion: version, expectedActiveRulesVersion: version })
  .strict();
export const evidenceSchema = z
  .object({
    expectedCaseVersion: version,
    orderId: identifier,
    orderVersion: version,
    tracking: text,
    type: z.enum(["PACKING", "DELIVERY", "ITEM_CONDITION"]),
    source: z.enum(["SELLER", "BUYER", "CARRIER"]),
    reference: text,
    observedAt: z.number().int().nonnegative().safe(),
  })
  .strict();
export const reviewSchema = z
  .object({
    expectedCaseVersion: version,
    expectedEvidenceVersion: version,
    reviewStatus: z.enum(["VERIFIED", "REJECTED"]),
    reason: text,
  })
  .strict();
export const decisionSchema = z
  .object({
    expectedCaseVersion: version,
    expectedActiveRulesVersion: version,
    decision: z.enum(["RETURN_THEN_REFUND", "DISPUTE"]),
    reason: text,
  })
  .strict();
export const acceptSchema = z
  .object({
    expectedSuggestionVersion: version,
    expectedActiveRulesVersion: version,
  })
  .strict();
export const rejectSchema = z
  .object({ expectedSuggestionVersion: version, reason: text })
  .strict();
