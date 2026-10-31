# A–E scenario specification for team review

Status: **proposed baseline**. Khoa owns the final scenario matrix; Nhân must seed from this same specification after joint review. All data and IDs below are synthetic. Anchor `deliveredAt` to the seed time minus one day so fresh local tests stay inside the proposed seven-day window; tests should inject a clock for boundaries.

| Case | Seed order | Canonical facts | Proof at seed | Expected initial outcome |
| --- | --- | --- | --- | --- |
| A | `demo-a`, 189,000 VND, `trk-a` | Shirt, `SIZE_MISMATCH`, item `WRONG_SIZE`, seller packed wrong size; no risk flags | `SELLER` / `PACKING`, current order ID, version and `trk-a`, owner `VERIFIED` | Intake evaluates automatically to `RETURN_THEN_REFUND`; one `SIMULATED` receipt |
| B | `demo-b`, 245,000 VND, `trk-b` | Damaged bottle, `DAMAGE`, item `DAMAGED`, no risk flags | None initially; requires `SELLER` / `PACKING`, current order ID, version and `trk-b`, owner `VERIFIED` | `WAITING_EVIDENCE`, ask for `SELLER_PACKING_PROOF`; no receipt |
| C | `demo-c`, 1,250,000 VND, `trk-c` | Headphones, denied receipt versus delivery record, three complaints in 90 days | `CARRIER` / `DELIVERY`, current order ID, version and `trk-c`, initially `SUBMITTED`; owner must mark `VERIFIED` before DISPUTE | `NEEDS_OWNER_REVIEW` with `DELIVERY_CONFLICT`, `REPEATED_COMPLAINTS`, `OVER_HARD_CAP`; no auto completion |
| D | `demo-d`, 199,000 VND, `trk-d` | Shirt does not fit, `FIT_ISSUE`, item `UNUSED_TAGS_INTACT`; no risk flags | `BUYER` / `ITEM_CONDITION`, current order ID, version and `trk-d`, owner `VERIFIED` | `NEEDS_OWNER_REVIEW`; eligible owner `RETURN_THEN_REFUND` creates one `PENDING` suggestion |
| E | `demo-e`, 279,000 VND, `trk-e` | Different shirt/order, same `FIT_ISSUE` and `UNUSED_TAGS_INTACT`; no risk flags | `BUYER` / `ITEM_CONDITION`, current order ID, version and `trk-e`, owner `VERIFIED` | Before rule accept: owner review. After separate D suggestion accept and fresh evaluate: auto completion with D provenance |

## Negative and boundary cases

- B proof from `BUYER`, with wrong order ID, wrong tracking, stale order version, or `SUBMITTED` status cannot resume. Attempting `VERIFIED` on wrong/stale context returns 409 and leaves review state unchanged. Only owner verification of current `SELLER` packing metadata creates the resume operation.
- C owner can choose non-monetary `DISPUTE` only after relevant current delivery proof review. The simulated closure keeps all three risk flags and creates no suggestion. Owner-approved monetary completion follows the same 300,000 VND hard cap as automatic completion.
- D case decision, suggestion acceptance, and E re-evaluation are three distinct operations. Pending/reject cannot change active rules. E has a different order ID and price to prove the learned predicate is generalized within the hard cap.
- An E order above 300,000 VND, outside the inclusive delivery window, lacking current verified proof, with a risk flag, or with a different reason/condition cannot auto complete even after D rule acceptance.
- Exact 300,000 VND and exactly seven days after delivery are eligible only when all other guards pass. One VND or one second beyond is ineligible. A missing delivery timestamp is represented as `deliveredAt: null`; both automatic and owner-approved monetary completion must reject it without substituting the current time. Future delivery time is also ineligible. The final D1 commit must recheck current DB time.
- Duplicate intake/review/accept keys replay their original response. A changed payload under the same key conflicts. Racing different keys can produce only one case receipt and one active semantic rule. Stale case/evidence/suggestion/catalog versions yield 409 without state, success audit, or receipt.
- Missing model key/ID, timeout, provider failure, bad tool arguments, and tool/round budget exhaustion cannot mark a case `COMPLETED`. A separate eligible owner manual recovery is `MANUAL + SIMULATED`, `agentRunId: null`, with no technical-exception learning.
- Identity checks: anonymous 401, member-only account calling owner action 403, cross-shop ID 404, forged actor/reviewer/mode/body fields rejected. Hosted requests cannot activate local TEST identity.

Proof references are plain catalog text such as `demo-proof-b-correct`; they do not represent uploaded files or AI vision verification. No fixture claims marketplace, buyer-message, or payment integration.
