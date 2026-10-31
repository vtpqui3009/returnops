# Shared Sign in with ChatGPT demo

**Date**: 2026-10-31 15:52 ICT  
**Severity**: High  
**Component**: ReturnOps hosted identity and judge demo  
**Status**: Partially verified

## What Happened

The requirement changed from one private owner to a shared judge demo: any genuine ChatGPT-signed-in visitor should be able to run the full synthetic demo as the effective OWNER, without email collection or invitations. This was implemented as an opt-in runtime mode. The default remains the existing `OWNER_USER_IDS`/`MEMBER_USER_IDS` allowlist behavior.

## The Brutal Truth

The new mode intentionally broadens authority for demo convenience. It is acceptable only because the data and receipts are synthetic and the mode is explicitly opt-in after identity-trust checks. It must never be mistaken for production tenant authorization. A second independent account was not tested, so “any judge” remains a claim supported by design and one genuine signed-in run, not complete coverage.

## Technical Details

- TDD started red with `FORBIDDEN`, then passed after the shared-mode behavior was added.
- Root dynamic sign-in redirect and shared demo banner were verified; no database reset was performed.
- Full local suite: 36 tests passed; typecheck and build passed; existing lint warning remains.
- Hosted version `4`, source SHA `e49c9e41e77071b91b7589abdde8ae8aae72a6ee`, environment revision `6`, Site public-policy revision `2`.
- Final root behavior: anonymous API returned JSON `401`; fake identity headers also returned JSON `401`.
- A genuine signed-in user reached API `200` and created a new C intake, LIVE `gpt-6.1-terra`, `NEEDS_OWNER_REVIEW`, `200`; the case has three flags, no receipt, and is ready for judge review.
- Previous five completed receipts persisted; total persisted count is six.
- Existing model secret was reused; no new API key was created.
- Evidence: `plans/reports/hosted-261031-1552-GH-11-shared-signin-evidence.json`.

## Decision and Alternatives

Shared sign-in mode was selected over email invites and over anonymous API access. Anonymous access would make it impossible to distinguish judges from spoofed requests. Per-user actor identity is retained for attribution, while demo authorization grants the OWNER capability only inside the explicit shared mode. The default-off flag preserves the private deployment behavior.

## Lessons Learned

Public audience policy and application authority must be tested independently. A public Site can still require genuine sign-in, and fake headers must fail at the application boundary. Opt-in demo authority should be isolated behind a runtime flag, visibly disclosed, and never accompanied by a reset path.

## Next Steps

1. Run one second independent signed-in account and confirm the same judge path.
2. Keep the shared banner and synthetic-data disclosure visible.
3. Update README, backend runbook, deployment notes, and API documentation with the shared-mode contract.
4. Hand the evidence packet to Khoa; retain open issue status until independent access is verified.

## Unresolved Questions

- Does a second account receive the expected shared OWNER demo behavior?
- Are recovery and mobile checks still required before full issue closure?
- Who formally accepts the broadened demo authority for judge access?
