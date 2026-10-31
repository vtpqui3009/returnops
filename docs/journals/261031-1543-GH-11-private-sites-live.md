# Private Sites live verification

**Date**: 2026-10-31 15:43 ICT  
**Severity**: High  
**Component**: ReturnOps hosted Sites, D1, identity, OpenAI workflow  
**Status**: Partially verified

## What Happened

The private Site was deployed and exercised through the user’s real Chrome session. The verified URL is `https://returnops-nhan.loftycream129.chatgpt.site`, version `3`, source SHA `ffb3132fe631ae6687e52159f3fb5309ad31ea18`, environment revision `5`. Access remains owner-only.

## The Brutal Truth

This is the first real hosted evidence, and it is strong enough to prove the core path works. It is still not full issue closure. We verified one owner identity and one browser session; independent member access, recovery, mobile, and Khoa handoff remain unrun. Calling this production-ready would be dishonest.

## Technical Details

- Native D1 schema/migration verification passed.
- A gated one-time initialization route created migration state version 2 and seeded five synthetic records; the secret was removed afterward. Repeating initialization preserved data. The route was physically removed in version 3 and verified `404`; the attempted post-removal access returned `403` before removal.
- `/api/identity` supplied the real Site-specific owner ID. `OWNER_USER_IDS` was configured without changing `actor()` or auth code.
- Local validation: 34 tests passed, typecheck passed, build passed; existing lint warning remains.
- Hosted API returned `200` in the real Chrome session. A–E ran live with `gpt-6.1-terra`; all five produced one simulated receipt: A/B/E automatic, D/C manual. D suggestion was accepted in the UI, then E was reevaluated in the UI with the correct source case. C produced three flags and no learning. A replay and a negative `400` case passed.
- The five receipts survived compatible redeploy and page reload. Evidence is in `plans/reports/hosted-261031-1543-GH-11-evidence.json` and `plans/reports/hosted-261031-1543-GH-11-persistence.json`.

## What We Tried

We first used a secret-gated initialization path to provision the hosted synthetic state, verified repeat preservation, then removed both the secret and route. We separately exercised identity, live provider calls, UI owner actions, replay, negative validation, redeploy persistence, and reload persistence. No new application edits or deployments were made during this journal step.

## Root Cause Analysis

The original blocker was environmental rather than an application defect: hosted D1 state, Site-specific identity, and provider secret configuration did not exist. Native Sites tooling and the OpenAI Developers key flow resolved those dependencies. The remaining gaps are test-scope gaps, not failures in the verified owner path.

## Lessons Learned

Hosted proof must include provenance, database initialization behavior, identity source, provider model, replay/negative cases, and persistence across redeploy. A page loading or API `200` alone proves almost nothing. One-time bootstrap routes must be removed and verified unreachable before handing out a private URL.

## Next Steps

1. Run an independent member login and unauthorized-user check.
2. Run recovery and mobile QA, then hand the evidence packet to Khoa.
3. Keep the Site private until those checks are reviewed.
4. Update the runbook/README and plan status from the evidence, without exposing secrets, IDs, emails, or cookies.

## Unresolved Questions

- Can Khoa independently access the owner-only Site and reproduce the evidence packet?
- What is the result of a fresh member login and recovery/mobile pass?
- Does the project want to close the full issue before those checks, or record them as explicit NOT RUN items?
