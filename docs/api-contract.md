# ReturnOps API contract

This contract is implemented by `src/server/api.ts` and the route adapters under `app/api/`. It covers one synthetic shop, D1 persistence, metadata-only proof, and simulated outcomes. The API never sends buyers messages, submits marketplace actions, or moves money.

## Authentication and mutation rules

Hosted requests are trusted only when the Sites ingress has been verified and
`SITES_IDENTITY_VERIFIED=true` is set server-side. Every protected route
requires both the Sites user ID and email headers. With
`RETURNOPS_SIGNED_IN_DEMO=true`, any verified signed-in identity receives the
synthetic demo `OWNER` role and uses the shared D1 fixtures; this does not grant
access to real customer data. With the flag unset or `false`, the server maps
the identity to `OWNER_USER_IDS` or `MEMBER_USER_IDS`. Missing trust or identity
returns `401 UNAUTHENTICATED`; an authenticated ID outside the allowlists in
default mode returns `403 FORBIDDEN`. Anonymous access is never enabled.

Every mutation requires a same-origin `Origin` header, JSON content type, an `Idempotency-Key` with 1–128 printable characters, and only documented JSON fields. Unknown or malformed fields return `400`. Bodies are limited to 16 KiB. Money is positive integer VND and times are epoch seconds. Exact resource-version checks return `409 STALE_VERSION` when stale.

`POST /api/demo/reset` is the one supported hosted data refresh. It is
available only when `RETURNOPS_SIGNED_IN_DEMO=true` and the caller is a
verified signed-in demo OWNER. It requires the same origin, JSON, an
`Idempotency-Key`, and exactly `{"confirm":"reset-shared-demo"}`. It atomically
clears shared workflow history and learned rules, restores the canonical five
synthetic A–E cases with catalog version 1, and returns
`{"reset":true,"caseCount":5}`. Reset acknowledgements survive later resets,
so an old retry cannot erase newer progress. The operation is global and
irreversible; anonymous/default allowlist mode returns 404 for this route.

Each mutation stores an immutable REQUEST acknowledgement scoped to shop, actor, method, action, resource, and idempotency key. Replaying the same validated payload returns the original status/body, even when its linked EVALUATION is running or failed. Reusing a key with another payload returns `409 IDEMPOTENCY_CONFLICT`. EVALUATION rows have independent `PENDING`, `RUNNING`, `COMPLETED`, or `FAILED` status.

Errors use `{ "error": { "code": string, "message": string, "requestId": string } }`; internal failures are redacted.

## Routes

| Method | Route | Input / result | Permission |
| --- | --- | --- | --- |
| GET | `/api/identity` | Current Sites-scoped user ID only; no role or credentials | Any trusted signed-in Sites user |
| POST | `/api/demo/reset` | `{confirm:"reset-shared-demo"}` → `{reset:true,caseCount:5}` | Shared demo OWNER only |
| GET | `/api/cases?status=&cursor=&limit=` | Bounded queue, versions, flags, next cursor | Member/owner |
| GET | `/api/cases/:id` | Case, current order snapshot, evidence, evaluation, timeline, receipt | Member/owner |
| POST | `/api/cases` | `IntakeRequest` → `201 {caseId,evaluationOperationId}` | Member/owner |
| POST | `/api/cases/:id/evaluate` | `EvaluateRequest` → `202 {caseId,operationId}` | Member/owner |
| POST | `/api/cases/:id/evidence` | `SubmitEvidenceRequest` → `201 {evidenceId,evidenceVersion}` | Member/owner |
| POST | `/api/cases/:id/evidence/:eid/review` | `ReviewEvidenceRequest` → `200` review and optional evaluation ID | Owner |
| POST | `/api/cases/:id/owner-decision` | `OwnerDecisionRequest` → `200` manual simulated receipt and optional suggestion | Owner |
| GET | `/api/rule-suggestions?status=` | Suggestions, active rules, catalog version | Member/owner |
| POST | `/api/rule-suggestions/:id/accept` | `AcceptSuggestionRequest` → new rule/catalog version | Owner |
| POST | `/api/rule-suggestions/:id/reject` | `RejectSuggestionRequest` → rejected version | Owner |

Request and response interfaces are in `src/shared/contracts.ts`. Route adapters are thin; authorization, validation, persistence, and workflow logic stays server-side.

## Policy and workflow

The approved DEMO policy uses an inclusive hard cap of 300,000 VND and a seven-day delivery window. `deliveredAt=null`, future delivery times, expired windows, missing current proof, and risk flags block monetary completion. The final D1 guard rechecks current clock-sensitive facts. `DISPUTE` is a non-monetary owner closure and preserves risk flags.

Proof is metadata only: order ID/version, tracking, type, source, reference, observed time, review state, and reviewer. Only an owner can set `VERIFIED`; wrong or stale order/tracking/version returns `409 PROOF_CONTEXT_MISMATCH` without changing evidence or resuming evaluation.

The agent uses the server-only OpenAI Responses API with model `OPENAI_MODEL` (approved default `gpt-5.6-terra`). It can call only `read_order`, `check_policy`, `list_missing_evidence`, `draft_reply`, and `escalate`. Limits are eight tool calls, nine model rounds, and 30 seconds. Deterministic policy remains authoritative. Provider errors, invalid tools, refusals, missing configuration, and timeouts fail closed. Technical-error owner recovery is a separate `MANUAL + SIMULATED` action with no technical-exception learning.

Automatic receipts are unique per case and always `SIMULATED`; manual receipts have `agentRunId: null`. `LIVE`, `TEST`, and `REPLAY` describe the agent execution attempt, not a real-world side effect.

## Learning flow

Owner D completion and rule acceptance are separate mutations. Eligible D creates one `PENDING` suggestion without changing the active catalog. Reject leaves the catalog unchanged. Accept requires both suggestion and catalog versions, inserts one normalized immutable rule, increments `activeRulesVersion` once, and preserves source-case provenance. E must be evaluated again with fresh versions; a pending or rejected suggestion cannot affect E.

## Representative failure cases

- anonymous request: `401 UNAUTHENTICATED`;
- member owner action: `403 FORBIDDEN`;
- stale case/evidence/suggestion/catalog version: `409 STALE_VERSION`;
- active competing evaluation: `409 CASE_BUSY`;
- mismatched proof context: `409 PROOF_CONTEXT_MISMATCH`;
- same key, different payload: `409 IDEMPOTENCY_CONFLICT`.
