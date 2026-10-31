# Issue #11 planning: UI/API integration and private deployment

**Date**: 2026-10-31 14:00 ICT
**Component**: ReturnOps UI, Worker API, D1, Sites deployment
**Status**: Ongoing

## Context

The user asked for a `ck:plan` implementation plan from GitHub issue #11 on branch `feat/11-ui-api-integration`. The plan covers three gates: integration baseline, real-route local acceptance, and private hosted deployment/handoff.

## What happened

The merged backend (`39d449eca4174527cc590efbd2a634455225db26`) and UI (`1e115276aaf0a7a0a5611cd2564b6ded17f11dd0`) already contain the four recovery fixes named in the issue. Existing browser checks still intercept API calls, and `ui-local` mounts the component against a dispatcher/D1 harness. Full Vinext route coverage is absent: `tests/e2e/planned.spec.ts` is `test.fixme`, while `tests/scripts/preflight.mjs:21` blocks E2E.

## Reflection

We cannot call this integrated or deployed from source inspection. No migration, provider call, browser run, or hosted check was performed. A concrete likely harness defect is visible: `tests/scripts/build-ui-probe.mjs:19` copies four UI files but omits `presentation.ts`, even though `returnops-app.tsx:7` imports it. This was found during planning and remains unexecuted, so it is a hypothesis until the pinned bundle is built.

## Decisions

- Reuse the existing API adapter, fixtures, `RuntimeAdapter`, and D1 scripts. Do not add a second client, fixture set, auth bypass, or deployment abstraction.
- Nhân owns technical UI/API, backend/D1, and deployment; Khoa owns QA/evidence/package; Quí owns pitch.
- Require exact integrated and deployed SHAs. Label results local/hosted and TEST/REPLAY/LIVE; manual actions remain MANUAL, receipts remain SIMULATED.
- Treat protected identity, hosted persistence, provider-backed A–E, and judge access as independent evidence gates.
- `ck` is unavailable (`ck: command not found`), so plan files use the documented Markdown fallback. Plans are gitignored local artifacts.

## Next steps

Three-lens plan review completed: six deduplicated findings (one Critical, three High, two Medium). Proposed fixes await user disposition: correct full-route LIVE semantics, define isolated app/D1 launch, guard hosted seed-once provisioning, clarify API-driven intake, keep NOT RUN blocking completion, and distinguish edge denial from Worker 401. No implementation started.

1. Pin the shared SHA and repair the QA bundle dependency if reproduced.
2. Run the real Worker/Vinext route through canonical A–E, negative, and recovery cases with Khoa's fixture/session adapter.
3. After local acceptance, deploy one existing private Site, verify ingress anti-spoofing before setting trust, run hosted persistence/auth/provider checks, and hand off URL, SHA, runbook, and evidence.

## Unresolved questions

- Which private Site/D1 target and authenticated deployment tool are available?
- Who can attest protected identity and configure server-only allowlists/model settings?
- What owner-approved hosted fixture provisioning avoids destructive reset?
