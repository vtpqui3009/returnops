# Phase 1 baseline finally has a reviewable shape

**Date**: 2026-10-31 11:08 ICT  
**Severity**: Medium  
**Component**: Sites/Vinext scaffold, D1 contract, shared workflow specification  
**Status**: Ongoing

## What Happened

We built the Phase 1 baseline from the official ChatGPT Sites Vinext starter. The repository now preserves `sites()`, declares the `DB` D1 binding, and contains shared types, the API contract, A–E scenarios, and local run guidance. The change is committed as `3c3b6b6` on `feat/nhan-baseline` and is in draft PR #5.

The first contract review caught real problems before UI and integration lanes could fork: owner requests accepted the unrestricted `Decision` union, several documented responses had no shared TypeScript shapes, timeline events did not expose execution/completion modes, and D/E proof requirements were too vague. We fixed all four issues before the re-review.

## The Brutal Truth

This was not a finished product. It was a long setup day that ended with a credible boundary and no backend behavior. The dependency install took 14 minutes and delayed validation, which was frustrating, but the delay exposed how little evidence we had until the toolchain actually ran. We still have no Site, hosted D1, LIVE model call, API route, migration, seed, or team approval. Calling this “done” would be dishonest.

## Technical Details

- `npx tsc --noEmit`: PASS
- `npm run build`: PASS; emitted Node `DEP0040` punycode deprecation and a non-fatal Vinext route-classification notice
- Local D1 smoke: `SELECT 1 AS binding_ok` returned `binding_ok: 1`
- `git diff --check`: PASS
- No test runner or test files exist in this baseline; automated coverage is N/A

## Decision and Root Cause

We stopped after Phase 1 as requested and kept Phase 2/3 pending. The contract remains a proposal until the team approves identity/roles, model/tool probe, demo cap/window, and the shared baseline SHA. The initial contract gaps came from documenting routes before making every response and permission boundary explicit in the shared type layer.

## Lessons Learned

Treat shared types as the review gate, not an appendix. Every documented route needs a response type, and every permitted action needs a narrower input union when policy is still pending. Run the actual starter build before claiming a baseline is executable.

## Next Steps

Nhân/dot: confirm the single Site and trusted identity boundary. Team: approve model, policy, roles, and contract; review and merge PR #5, then record one SHA across issues #1–#3. Only after that should Phase 2 implement D1/API/agent behavior.
