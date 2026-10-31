# ReturnOps test skeleton

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
| Harness | Eight executable self-tests. Local response doubles are infrastructure checks only. |
| API | Executable draft assertions for A-01, B-01, B-02, B-03, C-01, D-01, E-01 and E-02, using real HTTP calls and shared contract types. They have not been run against ReturnOps. |
| Remaining matrix cases | Thirty-five explicit `fixme` inventory entries. They are NOT RUN, with no passing placeholder assertions. |
| Browser E2E | Twelve planned entries: A–E main flows, UI-N01/02/03 and SEC-N01. No UI driver/selectors are implemented; the E2E command is blocked accordingly. |
| D1/deployment | No direct database mutation or deployment automation. Nhân/dot owns those operations; they need separate evidence. |

Test discovery lists 63 entries: 8 harness tests, 8 API tests, 35 planned matrix assertions and 12 planned E2E assertions. These are not 63 executed product scenarios. Matrix IDs are read from `docs/test-matrix.md`; changing that document updates the planned inventory automatically. Existing executable IDs must remain in the matrix.

## Connect the real API

First coordinate with Nhân to implement the adapter described in [adapters/README.md](adapters/README.md). It resets canonical A–E synthetic fixtures and supplies real approved MEMBER/OWNER sessions. It must not invent a public reset endpoint, forge Sites identity headers, or substitute mocked API responses.

Start the backend separately after its routes, migrations and seed/reset exist. The test runner does not start the baseline placeholder app or provision a Site. Then configure the test process; for PowerShell:

```powershell
$env:RETURNOPS_TEST_BASE_URL = 'http://127.0.0.1:5173'
$env:RETURNOPS_TEST_ALLOW_MUTATIONS = '1'
$env:RETURNOPS_TEST_ADAPTER = './adapters/local.mjs'
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
- Playwright stores attachment files under `tests/artifacts/results/`. That directory may be cleaned by the next run; archive the entire relevant artifacts directory before replacing it when evidence must be retained. Keep summaries and referenced attachments together.
- Artifacts, auth state, local adapters and test dependencies are ignored by Git. Review/redact evidence before attaching it to an issue, PR or submission.
- Update the matrix result/evidence fields only after a real run, using the tested SHA, fixture/environment and actual output. The reporter never rewrites the matrix automatically.

Current product results remain **NOT RUN**: runtime endpoints, canonical seed/reset, trusted identity sessions and UI drivers are unavailable to this skeleton. No deployment or LIVE model verification is claimed.
