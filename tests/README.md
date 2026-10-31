# ReturnOps QA harness

This branch builds on the test matrix in PR #7 and baseline `9243091`. It provides an isolated Playwright package for issue #3. The application package/lockfile, backend schema and policy are unchanged. Root `tsconfig.json` excludes this separate test package so an application-only installation does not require QA dependencies.

## Install and validate the harness

From the repository root, with Node.js 22.13.0 or newer:

```sh
npm --prefix tests ci
npm --prefix tests run typecheck
npm --prefix tests test
npm --prefix tests run test:list
```

The default `test` command runs **harness self-tests only**, using controlled local HTTP responses labeled TEST. It validates request headers/retry keys, URL boundaries, redirect handling, error handling, operation-aware polling and matrix linkage. A harness PASS is not a product/API/D1/E2E PASS. No browser installation, app server, model key or real customer data is needed for these checks.

## Current implementation status

| Layer | Status |
| --- | --- |
| Harness | Self-tests cover HTTP helpers, operation polling, catalog linkage and evidence reporting. |
| API | Main flows and negative cases exercise proof, policy boundaries, authorization, idempotency, races, transactional faults and the real agent validator with offline provider transport. Related-only probes retain their partial scope. |
| Local browser | The existing UI component from an identified UI commit runs in API mode against the local dispatcher/D1. Checks include A–E, retry, conflict, read states, pagination, persistence/reset and proof references. |
| Hosted / full app | Vinext/Sites route integration, hosted identity, hosted D1 migrations, deployment and judge access require separate environments and evidence. |
| D1/deployment | The bundled local adapter creates a fresh Miniflare D1 instance per case. Hosted D1, Sites ingress, deployment and judge access require separate verification. |

Use `test:list` to inspect discovery by project. Matrix IDs come from `docs/test-matrix.md`. Runner entries include harness checks and planned UI work, so use the per-layer report for acceptance counts.

## Run the complete local suite

Install application dependencies in the QA checkout and backend checkout using their existing `npm run install:ci` command. The local UI bundle uses React, React DOM and lucide-react from the QA checkout, and esbuild from the backend dependency tree. Install Chromium with `npm --prefix tests exec -- playwright install chromium`.

Use the local adapter variables below, then run:

```powershell
$env:RETURNOPS_UI_REF = '1e115276aaf0a7a0a5611cd2564b6ded17f11dd0'
npm --prefix tests run test:all-local
```

This runs harness, API and `ui-local` checks, and records unavailable full requirements as NOT RUN. `test:ui-local` runs the browser layer alone. The UI build helper reads the feature source files and local module dependencies at the specified Git revision into a separate ignored directory per commit. It mounts the real component with `testMode={false}` and serves it beside the backend dispatcher. Its result applies to that component/API integration. Record the UI commit and backend commit separately from the QA commit.

The suite uses a TEST runner for normal flows. Agent-fault cases exercise the backend's real `runAgent` validator with an offline Responses transport. Failed evaluations can retain the backend's default `LIVE` failure label before the injected runner returns. Those values do not establish contact with a real provider.

## Connect the real API

For local integration, use the checked-in [PR #8 adapter](adapters/README.md) with an isolated backend checkout. It loads the backend's actual dispatcher, SQL migration and seed factory, binds a loopback HTTP listener and injects a TEST provider. The QA client receives synthetic session cookies. No OpenAI credentials are required. Start with A-01, then run the API project.

For example, in PowerShell:

```powershell
$env:RETURNOPS_BACKEND_ROOT = 'D:\path\to\backend-checkout'
$env:RETURNOPS_TEST_BASE_URL = 'http://127.0.0.1:5187'
$env:RETURNOPS_TEST_ALLOW_MUTATIONS = '1'
$env:RETURNOPS_TEST_EXECUTION_MODE = 'TEST'
$env:RETURNOPS_TEST_ADAPTER = './adapters/pr8-local.mjs'
npm --prefix tests run test:api -- --grep A-01
npm --prefix tests run test:api
```

Adapter paths are relative to `tests/`, where npm runs the package scripts. Remote test deployments additionally require `RETURNOPS_TEST_ALLOW_REMOTE=1`; only use a designated synthetic test environment with approved access. The helper refuses redirecting API responses and URLs containing credentials, paths or query parameters. Sessions stay in ignored local adapter configuration or approved storage and are never attached to reports.

Missing target/mutation opt-in/adapter produces **NOT RUN** and a nonzero exit before product requests. Never use `npm test` as evidence that the real API passes. Direct `playwright test --project=api` bypasses the friendly preflight and is not the supported execution command; the fixture still enforces target and mutation requirements.

The API project runs serially with zero automatic retries because fixture reset is shared and contract retries must use the same idempotency key deliberately. Each API test prepares its own A/B/C/D/DE state through the adapter. A new intent uses a new key; polling waits for the specific operation ID, not an older completed result. Model/provider errors fail the API assertion instead of being relabeled as completed work.

The expected server execution mode defaults to TEST. The adapter must verify the actual mode before intake; a mismatch blocks the run. Set `RETURNOPS_TEST_EXECUTION_MODE=REPLAY` or `LIVE` only when intentionally validating that server mode. TEST/REPLAY API runs remain labeled accordingly and do not establish LIVE evidence.

Each evaluation has a 35-second polling budget with a 500 ms interval. The API scenario timeout is 180 seconds to accommodate the separate D intake, E intake and E re-evaluation in E-02 under the proposed 30-second model budget. Revisit these test budgets with the runtime implementation.

## Browser handoff

Before enabling `test:e2e`, coordinate routes and stable locators with Quí, implement UI scenario drivers, and replace the planned `fixme` bodies with real browser actions/assertions. Then remove the unconditional E2E blocker from preflight and install the required browser using `npm --prefix tests exec -- playwright install chromium`.

Keep case approval, rule acceptance and fresh evaluation separate. C requires current VERIFIED delivery proof. Proof references must remain plain text; SEC-N01 needs both browser observation and server/controlled endpoint request evidence, not only a screenshot. API result checks do not establish any of these browser acceptance criteria.

## Reports and evidence

- `tests/artifacts/<selected-projects>/summary.json` records the source commit, dirty-worktree flag, baseline, runner result and per-layer matrix status.
- Harness observations are separate from matrix results. A layer result is not full issue acceptance. Planned/skipped tests remain NOT RUN; failures/timeouts are FAIL at their executed layer. A blocked runtime setup is recorded as NOT RUN with a blocker, while the runner still exits nonzero for the infrastructure failure.
- API evidence attachments include fixture run ID and selected terminal case/operation/version/receipt/provenance fields; headers and session tokens are excluded. Detailed request logs, browser traces and video are disabled by default.
- Each execution has a separate archive containing its summary and selected evidence. See [QA evidence](reporting.md) for paths, field selection and handoff.
- Artifacts, auth state, local adapters and test dependencies are ignored by Git. Review/redact evidence before attaching it to an issue, PR or submission.
- Update the matrix result/evidence fields only after a real run, using the tested SHA, fixture/environment and actual output. The reporter never rewrites the matrix automatically.

The local dispatcher and D1 layer is executable. Vinext route wiring, browser E2E, hosted identity, hosted D1, deployment and LIVE provider runs require their own environment and evidence.
