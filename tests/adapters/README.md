# Runtime adapter handoff

Nhân owns canonical D1 seed/reset and trusted identity mapping. This skeleton does not invent a reset API, alter backend schema, or forge Sites identity headers.

Create an ignored `local.mjs` here once the real implementation is available. It must default-export the `RuntimeAdapter` interface in `../support/types.ts`:

- `prepare({ scenario, baseURL })` resets only an isolated synthetic test shop and returns `{ fixtureRunId, executionMode, headers: { MEMBER, OWNER } }`. Read executionMode from the actual server-side test configuration, not a hardcoded assumption. Both roles must use real sessions accepted by the server's approved identity configuration.
- Scenario is A, B, C, D or DE; DE seeds D and E together. Use the exact orders/proofs in `docs/scenarios.md`. Normal deliveredAt is seed time minus one day. Initial rules must not already match D/E, and no previous cases/receipts/suggestions should leak across tests.
- `cleanup({ fixtureRunId, baseURL })` is optional and must only clean that test run. The fixture waits for evaluation completion before cleanup, except failed/timed-out tests; the adapter must safely handle that case.
- Keep cookies/tokens in local environment or approved storage, not tracked files or logs. Return session headers only; never return `Origin`, `Host`, `Content-Type`, `Idempotency-Key` or `oai-authenticated-user-*` overrides.
- It must use Nhân's real seed/reset implementation. Do not return canned API responses or treat a mock as product acceptance.

The module path is resolved from the tests package working directory. Example PowerShell setting, after implementing the adapter: `$env:RETURNOPS_TEST_ADAPTER = './adapters/local.mjs'`.

No adapter is included because the backend seed/reset and roles are not implemented yet. Preflight therefore reports **NOT RUN** until handoff is complete.
