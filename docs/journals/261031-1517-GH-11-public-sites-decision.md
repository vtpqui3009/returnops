# Public Cloudflare Sites deployment decision

> Later decision (2026-10-31): user retained existing Sites login and OWNER/MEMBER permissions. Anonymous public demo proposal cancelled before implementation; continue the original protected deployment plan.

**Date**: 2026-10-31 15:17 ICT  
**Severity**: Medium  
**Component**: ReturnOps hosting, authentication, D1, OpenAI runtime  
**Status**: Ongoing

## What Happened

The deployment target was narrowed to a public Cloudflare Sites URL. The desired experience is an anonymous shared synthetic demo: visitors can load the UI, exercise workflow operations including owner-style demo actions, and trigger the server-side provider path. Real URL verification is required. No deployment or source implementation happened during this decision round.

## The Brutal Truth

The existing plan was built around private Sites identity and OWNER/MEMBER allowlists. That design cannot satisfy anonymous access by changing one hosting toggle: `src/server/auth.ts` currently rejects requests without verified Sites identity. Pretending the public Site is ready would produce a URL where the page loads but the API returns 401. The simplest useful demo also accepts shared mutable state and provider-cost exposure; that is a deliberate trade-off, not production security.

## Technical Details

The repository is a Vinext/Workers app with D1 binding `DB`. `actor()` requires `SITES_IDENTITY_VERIFIED === "true"`, then reads `oai-authenticated-user-id` and allowlists it. `.openai/hosting.json` declares `DB` but does not yet identify a hosted Site. The reviewed migration is `drizzle/0001_returnops.sql`; local migration/seed scripts are explicitly local-only. The brainstorm acceptance target is an anonymous browser run against the deployed URL, a provider-backed operation, and D1 persistence after reload.

## What We Tried

We compared private Sites identity, public Sites with explicit demo mode, and direct Cloudflare deployment. Private Sites preserved the current auth model but contradicted the anonymous audience. Direct Cloudflare would add a second deployment workflow. Public Sites with a clearly bounded demo mode fit the requested simplicity and existing stack, so it was selected.

## Root Cause Analysis

The original deployment plan optimized for protected handoff and assumed authenticated visitors. The new requirement optimizes for frictionless public demonstration. Those are different products. The missing piece is an explicit runtime demo mode that supplies a synthetic actor without trusting spoofable identity headers, while leaving the existing protected path available when demo mode is disabled.

## Lessons Learned

Treat “public URL” and “public API” as separate decisions. A public Sites audience does not automatically make the application API anonymous. Make demo authority explicit in server configuration, keep all provider credentials server-side, preserve idempotency and workflow guards, and label all outputs simulated. Shared state must be documented so a future maintainer does not mistake it for tenant isolation.

## Next Steps

1. Add and test the explicit anonymous demo configuration in the auth/runtime path.
2. Confirm the hosted synthetic-fixture provisioning process before any remote migration or seed.
3. Configure the Site manifest, D1, and server-side OpenAI settings without committing secrets.
4. Publish through Sites and record the exact source/version and returned public URL.
5. Verify anonymous UI/API access, one provider-backed workflow, owner demo actions, and persistence across reload/new session.

## Unresolved Questions

- Which supported Sites/OpenAI secret workflow is available for hosted `OPENAI_API_KEY` configuration?
- What bounded, once-only synthetic seed path is authorized for the hosted D1 database?
- What provider spend/rate cap is acceptable for a public demo?
