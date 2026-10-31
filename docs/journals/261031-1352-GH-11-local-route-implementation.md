---
title: "Issue #11 local route implementation"
created: 2026-10-31
status: in-progress
---

# Issue #11 local route implementation

## Context

User accepted the six red-team corrections. Goal: prove browser UI through same-origin routes and D1 before any private hosted handoff.

## What happened

- Plan corrections were propagated through all phases.
- Baseline evidence recorded compilation/type/lint/test/UI results at the prior SHA; ownership and evidence documents were updated.
- Tests now include an isolated local route launcher, API-mode Worker configuration, canonical local migration/seed, a local sign-in/readback sentinel and browser cases. The UI probe now copies `presentation.ts`.
- Final Chrome run `9000094e-daa0-40fb-8dff-2f251ed94151` recorded 14 PASS, 0 FAIL and 2 NOT RUN. It covers the owner-only A/B/C/D paths plus stale/replay, lost-response retry, rejected proof, metadata rendering/no-fetch, mobile Escape draft retention, loading/empty/reload and local auth checks. Separate temporary role profiles proved member 403 for an owner action, unknown 403 and disabled trusted identity 401.
- A model setting was configured locally. The supplementary local provider probe passed LIVE (two rounds, one tool). Isolated migration/seed, API-mode app startup and signed-in API intake against canonical seed also passed. None of this is protected-edge or hosted proof.

## Review outcome

Review initially found a false dual-role profile and weak D1 sentinel; both were corrected before the final Chrome run. Evidence storage now whitelists only needed observation fields. The current limitation is narrower: E-01 has no dedicated safe scenario and E-02 correctly stops when the LIVE source returns `AGENT_ESCALATION` without a learning candidate. B-02/B-N03 checks are compound behavior within primary rows, not independently attributed matrix rows. Hosted evidence remains absent.

## Decisions

- Phase 1 is complete as a dated baseline only.
- Phase 2 remains in progress; the owner-only local slice is evidence-backed, but it does not establish E learning/provenance or every independently attributable matrix requirement.
- Phase 3 remains externally blocked: no authorized private Site/D1, accepted SHA or hosted fixture authority.

## Next

1. Add an approved safe E source that does not escalate, then prove rule acceptance and fresh E provenance.
2. Record B-02/B-N03 as separate matrix rows if their independent status is required.
3. Obtain Khoa acceptance of the exact local revision.
4. Obtain Site/D1 and owner provisioning authority before hosted work.
