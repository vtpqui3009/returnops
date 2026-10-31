# ReturnOps API contract proposal

Status: **proposed for Nhân, Quí, and Khoa review**. No routes or workflow are implemented by the baseline scaffold. Shared TypeScript shapes live in `src/shared/contracts.ts`.

## Boundary and conventions

- One simulated shop. The server loads canonical order amount, delivery time, tracking, and version from D1. Browser input cannot set actor, role, reviewer, shop, amount, decision mode, or policy cap.
- Hosted identity comes from the Sites verified sign-in helper in `app/chatgpt-auth.ts`. Server-side allowlists map the stable Sites user ID to `OWNER` or `MEMBER`. Missing identity is 401; authenticated but disallowed action is 403; cross-shop resource is 404. Local TEST identity must be enabled by server-only local configuration and must never be enabled in a hosted build.
- Mutations require same-origin `Origin`, JSON body with only documented fields, and `Idempotency-Key` (opaque 1–128 printable characters). Request body size is bounded. Unknown fields and malformed values return 400.
- Money is positive integer VND. Timestamps are epoch seconds UTC. Resource versions are positive integers. Expected versions must be exact; stale state is 409. Cursor and page size are bounded, with server-owned opaque cursor content.
- Every mutation uses a REQUEST operation scoped by `(shop, actor ID, method, resource/action, Idempotency-Key)`. The payload hash is SHA-256 of a canonical JSON encoding of validated fields, including expected versions. Auth and validation run first; a matching committed REQUEST replays its original HTTP status/body before stale-version checks. Reusing a key with different input returns 409 `IDEMPOTENCY_CONFLICT`. A fresh intent needs a fresh key.
- The REQUEST acknowledgement is immutable. Its linked EVALUATION has independent `PENDING | RUNNING | COMPLETED | FAILED` state. GET detail exposes the current execution result or redacted error. A model failure never changes the prior 201/202 acknowledgement into an HTTP error.
- Response errors use `{ "error": { "code": string, "message": string, "details"?: object, "requestId": string } }`. `details` cannot reveal another shop's data. 500 responses are redacted. Version, busy, duplicate, and proof context conflicts use 409 with distinct codes.
- `SIMULATED` receipts, packets, and replies never mean payment, marketplace submission, or buyer delivery. `completionMode` (`AUTO | MANUAL`) is separate from agent `executionMode` (`LIVE | TEST | REPLAY`). Manual receipts have `agentRunId: null`.

## Routes

| Method | Route | Input | Success | Permission |
| --- | --- | --- | --- | --- |
| GET | `/api/cases?status=&cursor=&limit=` | Bounded filters | 200 queue with versions and next cursor | MEMBER/OWNER |
| GET | `/api/cases/:id` | Case ID | 200 `CaseDetail`, including evidence, timeline, evaluation and active rules version | MEMBER/OWNER |
| POST | `/api/cases` | `IntakeRequest` | 201 `IntakeAcknowledgement` | MEMBER/OWNER |
| POST | `/api/cases/:id/evaluate` | `EvaluateRequest` | 202 `EvaluateAcknowledgement` | MEMBER/OWNER |
| POST | `/api/cases/:id/evidence` | `SubmitEvidenceRequest` | 201 `EvidenceAcknowledgement`; submitted only | MEMBER/OWNER |
| POST | `/api/cases/:id/evidence/:eid/review` | `ReviewEvidenceRequest` | 200 `ReviewAcknowledgement` | OWNER |
| POST | `/api/cases/:id/owner-decision` | `OwnerDecisionRequest` | 200 case outcome, receipt and optional suggestion ID | OWNER |
| GET | `/api/rule-suggestions?status=` | Bounded status filter | 200 suggestions, active rules, `activeRulesVersion` | MEMBER/OWNER |
| POST | `/api/rule-suggestions/:id/accept` | `AcceptSuggestionRequest` | 200 rule ID and new catalog version | OWNER |
| POST | `/api/rule-suggestions/:id/reject` | `RejectSuggestionRequest` | 200 rejected suggestion/version | OWNER |

## State and policy

`Decision`: `REFUND_NOW | RETURN_THEN_REFUND | PARTIAL_REFUND | DISPUTE`. Only `RETURN_THEN_REFUND` may be automatic in the current demo proposal. `OwnerDecisionRequest` currently permits only `RETURN_THEN_REFUND | DISPUTE`; the server must reject other values. Rules for owner `REFUND_NOW` and `PARTIAL_REFUND` need team approval before enabling those actions. `CaseStatus`: `NEW | WAITING_EVIDENCE | NEEDS_OWNER_REVIEW | COMPLETED | TECHNICAL_ERROR`.

Case, order, evidence, suggestion, and active rules catalog versions are distinct. Evidence changes bump its own version and case aggregate evidence/case versions. Evaluation requires `expectedCaseVersion` and `expectedActiveRulesVersion`, captures the post-intent snapshot, and cannot reuse a decision computed against an older catalog. A case with an unexpired active evaluation returns 409 `CASE_BUSY` for a competing explicit evaluate. The receipt is unique per case.

Proof is metadata only: `caseId, orderId, orderVersion, tracking, type, source, reference, observedAt, evidenceVersion, reviewStatus, verifiedBy, verifiedAt, reviewReason`. `reference` is plain text and is never fetched or rendered as HTML. Only owner review may set `VERIFIED`; wrong/stale order or tracking produces 409 `PROOF_CONTEXT_MISMATCH` with no mutation or automatic resume. A later order change makes earlier verified proof stale without editing its history.

Team DEMO policy: amount/item value ≤300,000 VND and delivery window ≤7×24 hours, both inclusive, based on server and DB time, for automatic and owner-approved monetary completion. `OrderSnapshot.deliveredAt` is epoch seconds or `null` when unknown; `null`, future delivery time, or an expired window blocks monetary completion and must never default to current time. Owner `DISPUTE` is a non-monetary closure and may resolve C above the cap without clearing risk flags. Hard limits, proof requirements, and risk flags cannot be relaxed by the model or a learned rule. A learned rule may use only allowlisted reason group and item condition; it cannot include an order ID or source case price. Pending or rejected suggestions do not change active rules. Owner case decision and owner rule acceptance are separate mutations.

Model calls use the server-only OpenAI Responses API. Proposed limits are 8 total tool calls, 9 model rounds, and 30 seconds total; the selected `OPENAI_MODEL` must be approved and probed with real tool calling. Allowed read/draft tools are `read_order`, `check_policy`, `list_missing_evidence`, `draft_reply`, and `escalate`; the model cannot mutate the case, accept a rule, or choose a tenant. Missing key/model, timeout, refusal, invalid tool call, or provider error fail closed. A separate owner action may close an eligible technical error case as `MANUAL + SIMULATED`, without marking the failed run LIVE-success or creating a learned rule.

## Representative exchanges

Intake A (member): `POST /api/cases`, `Idempotency-Key: a-intake-1`, body `{"orderId":"demo-a","claim":"Received the wrong size"}` → `201 {"caseId":"<id>","evaluationOperationId":"<id>"}`. GET detail later shows `COMPLETED`, `RETURN_THEN_REFUND`, one `SIMULATED` receipt and an agent `executionMode` that truthfully labels LIVE/TEST/REPLAY.

Intake B uses the same shape. GET detail shows `WAITING_EVIDENCE` and `missingEvidence:["SELLER_PACKING_PROOF"]`. Submit proof creates `SUBMITTED`; it never resumes by itself. Owner review with `VERIFIED`, matching current order/tracking/version and expected case/evidence versions, returns a new `evaluationOperationId`. Wrong context returns `409 PROOF_CONTEXT_MISMATCH`; case/evidence versions remain unchanged.

Owner C reviews the relevant current delivery proof, then sends `{"expectedCaseVersion":4,"expectedActiveRulesVersion":1,"decision":"DISPUTE","reason":"Delivery evidence conflicts with the claim"}`. Result remains `SIMULATED`; `DELIVERY_CONFLICT`, `REPEATED_COMPLAINTS`, and `OVER_HARD_CAP` remain visible, with no rule suggestion.

Owner D sends `RETURN_THEN_REFUND` with a reason. An eligible result has one `PENDING` suggestion but active rules version stays the same. E evaluated while pending or after reject remains `NEEDS_OWNER_REVIEW`. Accept D's suggestion with both expected suggestion and catalog versions, then evaluate E with fresh versions and a new key; completion references the new rule ID/version and D's case ID.

Examples of failures: no signed-in visitor → 401 `UNAUTHENTICATED`; member calling review → 403 `FORBIDDEN`; stale `expectedCaseVersion` → 409 `STALE_VERSION`; same key with different body → 409 `IDEMPOTENCY_CONFLICT`. Retrying the same intake key and body returns the original 201 body even if its evaluation later fails. A terminal failure needs a new evaluate key; the original acknowledgement stays intact.
