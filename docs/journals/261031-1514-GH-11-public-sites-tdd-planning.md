# Public Sites demo TDD handoff

> Later decision (2026-10-31): user retained existing Sites login and OWNER/MEMBER permissions. Anonymous public demo proposal cancelled before implementation; continue the original protected deployment plan.

**Date**: 2026-10-31 15:14 ICT  
**Severity**: Medium  
**Component**: ReturnOps public deployment plan  
**Status**: Ongoing

## What Happened

The agreed public Cloudflare Sites demo was handed to a TDD-oriented planning flow. The planned sequence is: anonymous demo mode with tests first, Sites publication with hosted D1 synthetic data, then hosted URL acceptance checks. Planning is file-based because the `ck` CLI and active task surface are unavailable in this checkout. No source or deployment action was taken.

## The Brutal Truth

This is a plan handoff, not progress toward a live URL yet. The existing private deployment plan is being superseded for this demo, while its evidence remains historical. Calling the plan complete before its files exist would create false confidence and make the next engineer guess which audience model is authoritative.

## Technical Details

The implementation must address the current `src/server/auth.ts` behavior: anonymous requests are rejected unless trusted Sites identity is enabled and the user is allowlisted. The TDD phase should lock the intended public demo actor and preserve the protected path when demo mode is disabled. Later phases must use the reviewed `drizzle/0001_returnops.sql`, avoid local-only reset/seed commands against hosted D1, and validate the real URL with synthetic data and server-side provider configuration.

## Decision and Alternatives

`/ck:plan --tdd` was selected because the change alters an authorization boundary and public API behavior. A default plan would be shorter but would make it easier to implement anonymous access without regression coverage. Direct deployment work was deferred until the plan and tests define the exact behavior.

## Lessons Learned

The audience decision must be encoded in tests before publishing. Public hosting, anonymous API behavior, shared D1 state, and provider-backed actions are separate acceptance points. Keeping these as three explicit phases prevents a successful build or page load from being mistaken for hosted workflow acceptance.

## Next Steps

1. Confirm the planner writes `plans/261031-1514-GH-11-public-sites-deployment/plan.md` and all phase files.
2. Review the TDD test cases and public-demo boundaries before implementation.
3. Execute source changes and local checks only after the plan is present.
4. Publish through Sites, configure D1/secrets, then run anonymous hosted acceptance.

## Unresolved Questions

- Exact plan-file status and phase details are pending planner output.
- Hosted synthetic-fixture provisioning and secret workflow remain external dependencies.
