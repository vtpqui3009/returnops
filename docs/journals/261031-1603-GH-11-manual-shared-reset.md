# Manual shared demo reset

**Date**: 2026-10-31 16:03 ICT  
**Severity**: High  
**Component**: ReturnOps shared demo D1 lifecycle  
**Status**: Verified with explicit data-loss trade-off

## What Happened

Because there was no time to build per-user isolation, the user explicitly authorized a shared manual reset button. A new `POST /demo/reset` path is available only in shared demo mode to a genuinely signed-in OWNER. It requires same-origin JSON, a strict confirmation value, and an idempotency key. The reset atomically clears synthetic domain/history/rule state, restores five fresh A–E cases, resets the catalog to version 1, and does not call AI.

## The Brutal Truth

This deliberately erases shared demo history. That is acceptable only for synthetic judge data and only because the user approved it. The old five-case records are gone from hosted D1 by design; the evidence JSON is the surviving audit artifact. Anyone relying on the shared Site must understand that another judge can reset their work.

## Technical Details

- Reset acknowledgements remain in a ledger across resets; policy version increments to fence stale AI work.
- A reviewer found a concurrent reset race on a different idempotency key. The fix uses compare-and-swap against the captured version. A real D1 timing-gated test produced one `200` and one `409`.
- Reset tests: 8; full suite: 44 passed; typecheck and build passed; existing lint warning remains.
- Hosted version `5`, source SHA `9ebfe7ca3a59fc2dc6e87e37adc6c5df486d8896`, environment revision `6`; native publish succeeded and retained the public sign-in URL.
- Chrome UI cancel caused no POST and preserved the prior six records/catalog version 2. Confirmed reset completed in 811 ms, restored five new cases with no evaluations/receipts. A then ran LIVE `gpt-6.1-terra` and produced one simulated completion. Final UI reset plus reload showed five NEW cases, catalog version 1, and zero receipts. Anonymous reset POST returned `401`.
- Evidence: `plans/reports/hosted-261031-1603-GH-11-manual-reset-evidence.json`.

## Decision and Alternatives

Manual shared reset was chosen over per-user isolation because the deadline made isolation infeasible. The endpoint is gated and auditable, but it is still shared destructive state. No remote reset is available outside the explicit UI confirmation path.

## Lessons Learned

“Demo reset” is a destructive data operation even when records are synthetic. Confirmation, idempotency, CAS concurrency control, policy fencing, and a persistent acknowledgement ledger are required. A cancel-path test is as important as a successful reset test.

## Next Steps

1. Document the reset semantics and shared-state warning in the README, runbook, API, and deployment notes.
2. Preserve the evidence packet and disclose that historical demo records were intentionally erased.
3. Do not add further source, git, or deployment changes without a new requirement.

## Unresolved Questions

- Who owns communicating the reset behavior to future judges?
- Is per-user isolation required if the demo becomes long-lived or customer-facing?
