# Runtime adapter handoff

## Local HTTP with the PR #8 backend

`pr8-local.mjs` runs the backend API dispatcher and authorization/policy code from a trusted backend checkout. Each case uses a fresh, nonpersistent Miniflare D1 database, `drizzle/0001_returnops.sql` and the backend's canonical `seedDemo`. The HTTP listener and database are disposed after the case. No reset is performed against a running app or shared data store.

The listener binds to an unused `127.0.0.1` port and authenticates random, per-run synthetic MEMBER/OWNER sessions. It rejects inbound Sites identity headers and maps the opaque session cookie to a canonical actor on the server. The backend receives the request through its real `handleApi` entry point. Its injected provider returns a `TEST` result and a synthetic `test-…` response ID. The adapter does not load a provider key. Report this layer as **local HTTP / PR #8 dispatcher / Miniflare D1 / TEST agent / synthetic ingress**. Vinext route wiring, Sites identity, hosted D1, LIVE provider behavior and UI remain separate checks.

Use the backend revision under test (initial target `7fa08cce5603f7d3ee7554e265a3a9c3255e1db1`) in a separate checkout, with its dependencies installed using `npm run install:ci`. The adapter resolves `miniflare` and `tsx` relative to that checkout. Record the actual backend revision alongside the QA commit in your evidence. From the QA repository root:

```powershell
$env:RETURNOPS_BACKEND_ROOT = 'D:\path\to\backend-checkout'
$env:RETURNOPS_TEST_ADAPTER = './adapters/pr8-local.mjs'
$env:RETURNOPS_TEST_BASE_URL = 'http://127.0.0.1:5187'
$env:RETURNOPS_TEST_ALLOW_MUTATIONS = '1'
$env:RETURNOPS_TEST_EXECUTION_MODE = 'TEST'
npm --prefix tests run test:api -- --grep A-01
```

Run `npm --prefix tests run test:api` for the eight main flows, two negative cases and the identity probe. Use an unused port above 1023. `RETURNOPS_BACKEND_ROOT` must be absolute. The adapter starts its own server in TEST mode.

## Adapter for the deployed service

Once the team supplies an isolated deployment and approved identity/session mechanism, create an ignored `local.mjs` here to exercise the deployed routes. Export a default object implementing `RuntimeAdapter` in `../support/types.ts`.

- `prepare({ scenario, baseURL })` sets up an isolated synthetic test shop through the approved seed/reset mechanism. Return `{ fixtureRunId, executionMode, headers: { MEMBER, OWNER } }` with mode obtained from server configuration and real role sessions. Never run the local D1 reset CLI against a hosted target.
- Supported scenarios are A, B, C, D and DE. DE seeds D and E together. Use `docs/scenarios.md` and the backend fixture factory. Keep prior cases, receipts and suggestions isolated across tests.
- `cleanup({ fixtureRunId, baseURL })` only cleans the designated test run, including setup for failures or timeouts.
- Keep session material in approved storage. Return session headers only. Do not override `Origin`, `Host`, `Content-Type`, `Idempotency-Key` or `oai-authenticated-user-*` headers. Keep raw sessions out of files, logs and reports.

The adapter module path is relative to `tests/` when using npm package scripts. The app/hosted adapter depends on trusted role mapping, realistic sessions and approved fixture provisioning.
