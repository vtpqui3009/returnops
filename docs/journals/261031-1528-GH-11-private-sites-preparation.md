# Private Sites preparation after audience correction

**Date**: 2026-10-31 15:28 ICT  
**Severity**: Medium  
**Component**: ReturnOps Sites publication and hosted runtime  
**Status**: Blocked

## What Happened

The anonymous public-demo proposal was cancelled. The selected audience is again a private Cloudflare Site using Sites sign-in and OWNER/MEMBER allowlists. One owner-only Site was created and its project ID persisted. The local source was validated, pushed through the supported Sites source workflow, and saved as version 1.

## The Brutal Truth

The repository is prepared for publication, but there is no live deployment URL and no hosted application acceptance yet. A successful source push and saved version are easy to overread as “deployed.” They are only provenance. The remaining identity, D1, and secret configuration is the work that determines whether the Site actually functions.

## Technical Details

- Local `npx tsc --noEmit`, `npm test` (29/29), and `npm run build` passed.
- Sites source helper pushed commit `2092f3af998772f6bce97272dfba922476b6852f`.
- Sites saved version `1` for the private owner-only Site.
- `SITES_IDENTITY_VERIFIED` remains false; no hosted D1 seed, identity allowlist, or OpenAI secret is configured.
- No application auth changes were made. The existing `src/server/auth.ts` path remains authoritative.
- The Sites workflow indicates the OpenAI Developers integration is needed for supported hosted `OPENAI_API_KEY` setup; it is not installed in this session.

## Decision and Alternatives

Private Sites with platform identity was restored because it matches the existing authorization design and avoids exposing owner operations and provider calls anonymously. The public shared-state demo was rejected as unnecessary scope and is no longer the target.

## Lessons Learned

Audience changes must be reflected in the deployment state, not only in conversation. Preserve the saved source/version, but verify Site access mode and runtime variables before claiming completion. Keep “saved,” “deployed,” and “hosted acceptance passed” as separate statuses.

## Next Steps

1. Confirm the Site’s exact owner identity and configure OWNER/MEMBER IDs through protected Sites settings.
2. Configure `SITES_IDENTITY_VERIFIED=true` only after protected ingress and spoof/bypass checks.
3. Resolve the supported hosted D1 migration and synthetic-fixture seed procedure.
4. Install/use the supported OpenAI Developers secret workflow and configure server-only model/key values.
5. Deploy saved version 1, obtain the URL, and run hosted identity, D1 persistence, and selected A–E checks.

## Unresolved Questions

- What supported hosted procedure provisions the synthetic D1 fixtures exactly once?
- Which site-specific owner user ID should be allowlisted?
