# Runtime adapter handoff

## Local HTTP with the PR #8 backend

`pr8-local.mjs` runs the backend API dispatcher and authorization/policy code from a trusted backend checkout. Each case uses a fresh Miniflare D1 database in its own temporary persistence directory, `drizzle/0001_returnops.sql` and the backend's canonical `seedDemo`. The HTTP listener, database and directory are disposed after the case. Reset operates on that disposable fixture.

The listener binds to an unused `127.0.0.1` port and authenticates random, per-run synthetic MEMBER/OWNER sessions. It rejects inbound Sites identity headers and maps the opaque session cookie to a canonical actor on the server. The backend receives the request through its real `handleApi` entry point. Its injected provider returns a `TEST` result and a synthetic `test-…` response ID. The adapter does not load a provider key. Report this layer as **local HTTP / PR #8 dispatcher / Miniflare D1 / TEST agent / synthetic ingress**. Vinext route wiring, Sites identity, hosted D1, LIVE provider behavior and UI remain separate checks.

Use the backend revision under test (latest verified main `39d449eca4174527cc590efbd2a634455225db26`) in a separate checkout, with its dependencies installed using `npm run install:ci`. The adapter resolves `miniflare` and `tsx` relative to that checkout. Record the actual backend revision alongside the QA commit in your evidence. From the QA repository root:

```powershell
$env:RETURNOPS_BACKEND_ROOT = 'D:\path\to\backend-checkout'
$env:RETURNOPS_TEST_ADAPTER = './adapters/pr8-local.mjs'
$env:RETURNOPS_TEST_BASE_URL = 'http://127.0.0.1:5187'
$env:RETURNOPS_TEST_ALLOW_MUTATIONS = '1'
$env:RETURNOPS_TEST_EXECUTION_MODE = 'TEST'
npm --prefix tests run test:api -- --grep A-01
```

Run `npm --prefix tests run test:api` for all API entries. Use an unused port above 1023. `RETURNOPS_BACKEND_ROOT` must be absolute. The adapter starts its own server with synthetic identity and an injected agent.

Run `npm --prefix tests run test:api -- consistency.spec.ts` for B-N05 and R-N05 only. Their five variants cover proof changes before review and during evaluation, concurrent accept/reject, and both ordered terminal outcomes. The adapter exposes optional `localD1` controls in process. These pause the next TEST agent, change proof tracking and proof/aggregate evidence versions in the disposable fixture, and read selected SQL counts. The proof change keeps case/order/catalog versions fixed to isolate evidence snapshot fencing. Cleanup releases a held agent before draining HTTP requests. These controls are confined to the test adapter and its disposable database.

Additional controls patch designated fixture facts, seed a foreign-shop resource, reject receipt insertion within a real D1 transaction, lose a response after commit, reopen the same persisted local D1 store, perform canonical reset/seed and disable trusted identity. Each fixture gets a unique temporary persistence directory that cleanup removes. Browser cleanup drains active handlers and closes keepalive sockets before disposing D1.

The `ui-local` project bundles the existing UI component at `RETURNOPS_UI_REF`, serves it in API mode and uses opaque synthetic role cookies. It records the UI SHA separately. A pending-acknowledgement test delivers a genuine immutable review acknowledgement from D1 before releasing its held evaluation, then checks browser polling and completion. This bridge exercises the acknowledgement timing boundary while preserving the backend's actual acknowledgement body. Browser fault cases label injected errors and lost responses explicitly.

## Adapter for the deployed service

Once the team supplies an isolated deployment and approved identity/session mechanism, create an ignored `local.mjs` here to exercise the deployed routes. Export a default object implementing `RuntimeAdapter` in `../support/types.ts`.

- `prepare({ scenario, baseURL })` sets up an isolated synthetic test shop through the approved seed/reset mechanism. Return `{ fixtureRunId, executionMode, headers: { MEMBER, OWNER } }` with mode obtained from server configuration and real role sessions. Never run the local D1 reset CLI against a hosted target.
- Supported scenarios are A, B, C, D and DE. DE seeds D and E together. Use `docs/scenarios.md` and the backend fixture factory. Keep prior cases, receipts and suggestions isolated across tests.
- `cleanup({ fixtureRunId, baseURL })` only cleans the designated test run, including setup for failures or timeouts.
- Keep session material in approved storage. Return session headers only. Do not override `Origin`, `Host`, `Content-Type`, `Idempotency-Key` or `oai-authenticated-user-*` headers. Keep raw sessions out of files, logs and reports.

The adapter module path is relative to `tests/` when using npm package scripts. The app/hosted adapter depends on trusted role mapping, realistic sessions and approved fixture provisioning.
