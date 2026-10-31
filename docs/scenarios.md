# A–E scenario specification

Fixtures are synthetic and seeded by `scripts/demo-data.ts`. Each order is delivered one day before seeding, so it starts inside the seven-day window. The local seed is the single fixture source for backend tests and smoke runs.

| Case | Order and facts | Proof | Expected behavior |
| --- | --- | --- | --- |
| A | `demo-a`, 189,000 VND, `SIZE_MISMATCH`, `WRONG_SIZE` | Current `SELLER`/`PACKING`, verified | Intake evaluates automatically to `RETURN_THEN_REFUND`; one simulated receipt |
| B | `demo-b`, 245,000 VND, `DAMAGE`, `DAMAGED` | None initially | `WAITING_EVIDENCE`; no receipt until current seller packing proof is owner-verified |
| C | `demo-c`, 1,250,000 VND; delivery conflict and repeated complaints | Current carrier delivery proof starts submitted | Owner review is required; all `DELIVERY_CONFLICT`, `REPEATED_COMPLAINTS`, and `OVER_HARD_CAP` flags remain; owner `DISPUTE` creates no suggestion |
| D | `demo-d`, 199,000 VND, `FIT_ISSUE`, `UNUSED_TAGS_INTACT` | Current buyer item-condition proof, verified | Owner `RETURN_THEN_REFUND` creates one pending suggestion; active rules remain unchanged |
| E | `demo-e`, 279,000 VND, same fit predicate as D, different order | Current buyer item-condition proof, verified | Before D acceptance: owner review. After separate accept and fresh evaluation: completion cites D provenance |

## Negative and boundary checks

- B buyer proof, wrong order ID, wrong tracking, stale order version, or submitted-only proof cannot resume. A mismatched verification attempt returns `409 PROOF_CONTEXT_MISMATCH` and leaves state unchanged.
- Exact 300,000 VND and exactly seven days are eligible only when every other guard passes. One VND over, one second over, missing/future `deliveredAt`, missing proof, or a risk flag blocks monetary completion.
- Pending or rejected D suggestions do not change E. Accepting a rule requires fresh suggestion/catalog versions and a separate E evaluation.
- A same-key retry replays the original acknowledgement. A different payload under that key conflicts. Receipt and semantic-rule uniqueness prevent duplicate effects during races.
- Missing model configuration, timeout, provider failure, malformed tool call, refusal, and exhausted budgets cannot complete a case or create a receipt. Manual recovery is owner-authorized, simulated, and does not learn from a technical exception.
- Anonymous requests return 401; member owner actions return 403; cross-shop resources return 404; browser-supplied actor, role, reviewer, mode, tenant, amount, and policy fields are rejected or ignored.

Proof references are plain catalog text. They are not uploads, URLs fetched by the server, or vision verification.
