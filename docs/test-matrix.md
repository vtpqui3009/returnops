# ReturnOps — A–E test matrix

> Test design for [issue #3](https://github.com/vtpqui3009/returnops/issues/3), based on the UI acceptance criteria in [#1](https://github.com/vtpqui3009/returnops/issues/1) and backend criteria in [#2](https://github.com/vtpqui3009/returnops/issues/2). Prepared on 31 October 2026. **No tests have been executed; all results are currently NOT RUN.**

## Scope and result reporting

- Test one simulated shop through the real API and UI. Packets and receipts must be marked `SIMULATED`; do not send to buyers, submit to a marketplace, or transfer money.
- Mark `PASS` only after executing against an identified commit and recording observable evidence. Mark `FAIL` when the actual result contradicts the expectation. Mark `NOT RUN` when not executed or prerequisites are missing. Label mocks and replays `TEST`/`REPLAY`; they do not count as LIVE tests.
- Record API/domain, integrated UI, D1 persistence, and private deployment separately. A PASS at one level does not imply a PASS at another.
- Do not invent endpoints, payloads, status codes beyond the `403`/`409` required by the issues, or fixture values before the shared contract is agreed. `docs/scenarios.md` in the #2 baseline will be the shared scenario and fixture source; reconcile it before execution.

## Prerequisites for execution

| Prerequisite | What to verify |
| --- | --- |
| Shared baseline | The team has reviewed and merged the Vinext/Sites scaffold PR, shared types, `docs/api-contract.md`, and `docs/scenarios.md`; record the shared commit SHA. |
| Contract | Request/response and error envelope; case/rule versions; idempotency; proof metadata, current order/tracking and VERIFIED status; owner identity and permissions are specified. |
| Fixtures | Cases A–E have separate IDs, orders and tracking identifiers; Nhân and Khoa agree on seed/reset data; reset is separate from schema migrations. |
| Environment | Local and hosted D1 configurations are distinguished; build and typecheck work. Verify Sites access, D1 bindings and private URL separately before deployment QA. |

## Fixture specification for `docs/scenarios.md`

| Case | Minimum seed data | Test variants |
| --- | --- | --- |
| A | Valid order/case and applicable policy; if the scenario requires proof, seed current proof in a state accepted by the contract. | Replay the same idempotency key to verify exactly one receipt. |
| B | Order/case missing seller packing proof, with clear order ID and current tracking. | Wrong order/tracking; correct but unverified proof; proof made stale by an order/tracking change; correct VERIFIED proof; duplicate event. |
| C | Conflicting facts/evidence and sufficient escalation flags; valid owner actor. | Unauthorized actor; owner DISPUTE; check flags and learning after the decision. |
| D | Case with sufficient proof but no matching rule, and enough data to explain why a learning suggestion is eligible. | Owner decision with reason; PENDING suggestion; concurrent accept or stale version. |
| E | An order/case **different from D** with the same intended rule conditions and initial version. | Evaluate before accept, after reject and after accept; a variant exceeds a hard cap or has an escalation flag. |

Nhân and Khoa must agree on concrete values, identity, initial versions and reset order in the baseline. This matrix does not create a second A–E fixture set.

## Main flow matrix

| ID | Setup / trigger | Expected API, domain and data behavior | Expected UI / observable evidence | Result |
| --- | --- | --- | --- | --- |
| A-01 | Case A is valid and has the evidence required by the shared scenario; trigger intake/evaluate. | Workflow completes internally under policy; exactly one `SIMULATED` packet and receipt, with audit event, reason and policy/evidence version. Retry creates no second receipt. | Queue and case detail show the backend result, timeline and simulated receipt; refresh preserves the result. | NOT RUN |
| B-01 | Case B lacks seller packing proof. | Workflow waits for the correct proof type, does not complete automatically and creates no receipt. | UI identifies the missing proof and waiting state; no success is shown. | NOT RUN |
| B-02 | From B-01, add proof for the correct current order/tracking that is not yet VERIFIED. | Still waiting; a file's existence does not mean it has been verified. | UI distinguishes added proof from VERIFIED proof. | NOT RUN |
| B-03 | Owner verifies valid proof from B-02. | Workflow resumes automatically and completes internally once; audit links the current proof ID to the decision. | UI changes state after the API response, showing timeline and `SIMULATED` receipt; refresh preserves it. | NOT RUN |
| C-01 | Case C has conflicting evidence/risk flags under the scenario; evaluate, then owner reviews and decides DISPUTE. | No automatic action bypasses guardrails; record owner decision and reason; retain flags; create no learned rule. | UI shows all flags before and after the decision, DISPUTE and timeline; Learning inbox has no suggestion from C. | NOT RUN |
| D-01 | Case D has sufficient proof but no matching rule; owner decides the case with a reason. | Create a `PENDING` rule suggestion only if eligible; approving the case does not change active rules/version. | UI separates case decision from rule acceptance; Learning inbox shows PENDING and source D. | NOT RUN |
| E-01 | A case E distinct from D has the same conditions; evaluate while D's rule is PENDING. | Pending suggestion is not applied; E continues waiting for the owner, and this result must not be reused as a cached later result. | UI shows the current version and state before approval. | NOT RUN |
| E-02 | Separately accept D's rule, then re-evaluate E. | New rule is ACTIVE with an incremented version; E is **re-evaluated** with that version, source D and an audit event; result changes from E-01 per the scenario without exceeding hard caps. | UI shows separate acceptance, before/after, new version, source D, re-evaluation timeline and backend result. | NOT RUN |

## Negative cases, consistency and authorization

| ID | Action / variant | PASS condition | Test level | Result |
| --- | --- | --- | --- | --- |
| B-N01 | Attach proof with the wrong order or tracking to B. | No resume or receipt; return or persist an error/waiting state under the contract and give a reason. | API + UI | NOT RUN |
| B-N02 | Attach proof with correct identifiers that is not VERIFIED. | No resume; UI does not treat upload as verification. | API + UI | NOT RUN |
| B-N03 | Use previously valid proof made stale by a change to the current order/tracking. | No resume; audit/response identifies the proof as no longer current. | API + D1 + UI | NOT RUN |
| B-N04 | Repeat verification/resume events or retry after timeout. | No duplicate completion decision, packet or receipt; idempotency is verifiable. | API + D1 | NOT RUN |
| C-N01 | Owner resolves C with DISPUTE. | Flags remain; no pending/active learning is created from C. | API + D1 + UI | NOT RUN |
| D-N01 | Approve case D without accepting the rule. | Rule stays PENDING, active version does not change, and E-N01 remains waiting. | API + D1 + UI | NOT RUN |
| E-N01 | Evaluate/retry E while D's rule is PENDING or REJECTED. | Rule is not applied; E does not complete because of that suggestion. | API + UI | NOT RUN |
| E-N02 | Accept the rule, but E exceeds a hard cap or has an escalation flag. | Guardrail still blocks/escalates; the learned rule cannot bypass the hard cap. | API + D1 | NOT RUN |
| R-N01 | Repeat intake/evaluate/owner decision with the same idempotency key. | No duplicate mutation, intended audit event or receipt; replay response follows the contract. | API + D1 | NOT RUN |
| R-N02 | Two requests compete to update the same case/rule version, or accept a rule concurrently. | Only one mutation takes effect; stale request receives `409`, except a same-key replay handled per contract; no duplicate active rule/receipt. | API + D1 | NOT RUN |
| AUTH-N01 | A non-owner actor calls owner decision or accept/reject rule. | Server returns `403` without mutation; UI shows an error and no false success. | API + UI + D1 | NOT RUN |
| UI-N01 | API fails or times out during a write. | UI keeps the state unconfirmed, allows a safe retry, and does not show false success or decide policy itself. | Integrated UI | NOT RUN |
| UI-N02 | UI sends a stale version and receives `409`. | Show conflict, reload the current version and let the user decide again; do not silently overwrite. | Integrated UI | NOT RUN |
| DATA-N01 | Refresh/restart after a confirmed mutation; run an intentional reset. | D1 preserves saved data across refresh/restart; reset restores known fixtures without damaging schema or data outside the demo scope. | D1 + UI | NOT RUN |
| DEP-N01 | Privately deploy under one coordinator; verify bindings/migrations. | URL works with its access level recorded; data persists after refresh; local D1 is not confused with hosted D1. Judge access is a separate checkpoint after team approval of sharing. | Deploy + D1 | NOT RUN |
| B-N05 | Verify B's proof concurrently with changing current tracking/proof, testing both commit orders. | At resume, only VERIFIED proof still matching the current order/tracking is used; stale proof cannot complete the case. | API + D1 | NOT RUN |
| R-N03 | Reuse an idempotency key with a different payload or for another case/actor. | Do not return the wrong result or apply the prior mutation; key scope and error response follow the agreed contract. | API + D1 | NOT RUN |
| R-N04 | Mutation commits but the response is lost; client retries with the same key. | Final state, receipt and audit remain consistent without duplicates; UI reloads the confirmed result rather than showing a false error or success. | API + D1 + UI | NOT RUN |
| R-N05 | Accept and reject the same suggestion concurrently; repeat each action after a decision. | Exactly one valid final state; it cannot be both ACTIVE and REJECTED or create two new versions. Response/replay follows the contract. | API + D1 | NOT RUN |
| DATA-N02 | Inject a failure between mutation and audit event, or between decision and receipt; then retry. | No completed state lacks its corresponding event/receipt and no event records a mutation that did not happen; data is consistent after retry. Choose fault injection points based on backend design. | API + D1 | NOT RUN |
| AGENT-N01 | Missing key, model timeout/error or maximum tool steps exceeded. | Case enters a technical error/waiting-for-review state per contract; it does not complete automatically or create a receipt/rule, and UI does not report LIVE success. | API + UI | NOT RUN |
| AGENT-N02 | Model proposes an unallowed tool, self-approves, or returns a result beyond a guardrail. | Server rejects/does not execute the unauthorized action; policy controls the result and no unauthorized mutation occurs. | API + D1 | NOT RUN |
| AUTH-N02 | An actor authorized for one case uses another evidence/case/rule ID or spoofs owner identity in a request. | Server validates relationships and authorization using authenticated identity; no unauthorized disclosure or mutation. Exact error code awaits the contract. | API + D1 | NOT RUN |
| E-N03 | Test values immediately below, at and above agreed hard caps/time limits. | Results follow contract boundaries, rounding and time zone; a case exceeding limits does not automatically complete through a learned rule. | API + D1 | NOT RUN |
| DEP-N02 | Run migration/deployment again against hosted D1 containing demo data. | Repeated migration follows the supported procedure and preserves data and the correct binding; seed/reset does not run destructively on its own. | Deploy + D1 | NOT RUN |

These concurrency, failure and boundary variants are test designs. Before writing specific assertions, the team must agree on idempotency key scope, replay rules, error states, how current proof is determined, and exact thresholds in the contract.

## Minimum evidence for each run

Record one row per ID and environment; do not combine mock results with real execution.

| ID | Level / environment | Commit SHA | Result | Evidence (log, redacted response, screenshot/video, event/DB) | Blocker / notes |
| --- | --- | --- | --- | --- | --- |
| _Not executed_ | _Baseline unavailable_ | _—_ | NOT RUN | _—_ | _Waiting for shared contract and fixtures_ |

For WIP/final reporting, count PASS/FAIL/NOT RUN separately for API, integrated UI, D1 and deployment. Record build/typecheck/test commands and exit codes, commit SHA and remaining limitations. Keep secrets and real customer data out of logs, screenshots and the repository.
