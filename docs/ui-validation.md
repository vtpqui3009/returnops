# UI review evidence — issue #1

Validated on Windows, Node 24.18.0 / npm 11.16.0, against the merged shared baseline `92430915e529ae12f0a7ed5c4b2842d771498e86`. The latest fetched main, `c1e348e62172f396cdde04072f448208dfd887da`, adds only `docs/test-matrix.md`; it changes no application file or contract used here. This PR intentionally delivers mock UI review before backend integration.

## Independently run checks

| Check | Result | Evidence / scope |
|---|---|---|
| Locked installation (`npm run install:ci`) | PASS | Restored the committed dependency tree after the first Windows install missed an optional native binding. Required installed versions match the lockfile; package files remain unchanged. |
| `npm run build` | PASS | Final Worker-mode entry and all five Vinext build stages. Nonfatal upstream plugin-timing and route-classification notices remain. |
| `npx tsc --noEmit --incremental false` | PASS | Frontend and unchanged shared contracts. |
| `npm run lint -- --ignore-pattern output/**` | PASS | Local historical prototype scratch directory is excluded. A clean checkout has no `output/`; its normal `npm run lint` covers all committed files. |
| `node scripts/check-ui.mjs` | PASS, 14 tests | HTTP shape validation, immutable retries, permissions, current proof, A–E fixtures, negative policy examples, rule separation, versioning and cancellable/failed/timed-out polling. |
| `node tests/ui/browser.cjs` in API mode | PASS, 32 checks; zero runtime exceptions | [Full results](ui-evidence/results.json). Real React UI and same-origin HTTP adapter, with requests intercepted by the synthetic contract harness. This is **not** a real backend test. |
| `node tests/ui/review-smoke.cjs` in default TEST mode | PASS, 6 checks; zero runtime exceptions | [Full results](ui-evidence/review-mode-results.json). No request interception: five fixtures load, D decision/pending suggestion survive browser refresh, no `/api/` request occurs. |
| `git diff --check` | PASS | Whitespace validation. |

The HTTP browser checks exercise search/empty, A receipt, stale proof, C proof prerequisite and cancel, verified C DISPUTE with flags/no learning, wrong tracking/409 and draft retention, double clicks, plain-text evidence reference (SEC-N01), B review/resume, a committed write with a lost response and exact key/body retry, D pending rule, activation cancel, accept without E completion, separate fresh E evaluation/catalog/provenance, refresh, 403/recovery, and layouts at 1440/768/375 px. Polling cleanup, timeouts, older operations and failed evaluations are covered by the adapter tests.

## Reproduce browser QA

Run `node scripts/check-ui.mjs` first to compile the harness adapter into ignored `work/ui-tests`. Browser QA is optional tooling, kept separate from app dependencies: make Playwright available as `playwright` or set `PLAYWRIGHT_MODULE` to an existing local module. Set `PLAYWRIGHT_BROWSER_EXECUTABLE` if using an installed Chromium/Edge instead of a Playwright browser. `UI_BASE_URL` defaults to `http://127.0.0.1:5173`.

1. Start `npm run dev` without a mode setting. Run `node tests/ui/review-smoke.cjs`.
2. Add `RETURNOPS_UI_MODE=api` to local ignored `.dev.vars`, preserving other settings, and restart the dev server. Run `node tests/ui/browser.cjs`. `UI_SCREENSHOTS=docs/ui-evidence` refreshes the synthetic screenshots.
3. Remove only the test mode setting after QA. The branch defaults to the labelled TEST walkthrough for team review.

## Visual evidence

All screenshots contain synthetic fixtures. They were captured through the intercepted HTTP harness, with a persistent simulation notice, and inspected internally on desktop/mobile. They demonstrate layout and displayed contract results; they do not establish server behavior.

| Screen | Screenshot |
|---|---|
| Queue, desktop | [Queue](ui-evidence/queue-desktop.png) |
| A decision and simulated receipt | [Case A](ui-evidence/case-a-desktop.png) |
| C owner proof review | [Owner review](ui-evidence/owner-review-desktop.png) |
| Pending rule, separate activation | [Learning inbox](ui-evidence/rules-pending-desktop.png) |
| C resolved case with retained risk flags, 375 px | [Mobile case](ui-evidence/case-mobile.png) |

## Deferred integrated acceptance

**NOT RUN:** real API/agent/model calls, D1 migration/seed/persistence, server authorization/idempotency, hosted sign-in/role mapping, full cross-lane E2E, LIVE execution and deployment. UI disabling and fixture guards are not backend enforcement. No action sends to buyers, submits to a marketplace or moves money.

Backend PR [#8](https://github.com/vtpqui3009/returnops/pull/8) at reviewed head `11d5e7d3de00cae230016ab381cfdc845a87442b` remains an external integration gate: C carrier/delivery prerequisite, preservation of deterministic flags on model failure, and consistent snapshot reads need backend review/resolution. These are reported review findings, not independent real-BE validation by this frontend branch. No backend branch is merged or changed here.

Issue #1 stays open until actual API acceptance and team review. The human review column in the [UI handoff](ui-handoff.md) remains pending. CI evidence is reported on the PR for its exact pushed commit; local results above do not imply CI exists or passed.
