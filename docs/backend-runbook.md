# Backend runbook

## Local setup

Use Node.js 22.13.0 or newer. Install and run the static checks first:

```sh
npm run install:ci
npm run build
npx tsc --noEmit
npm run lint
npm test
```

## D1 lifecycle

These commands target only the local D1 store at `.wrangler/state`:

```sh
npm run db:migrate
npm run db:seed
npm run db:reset -- --confirm-local-reset
```

The reset command clears and re-seeds the local fixture set. Pass `--confirm-local-reset`; the script rejects other arguments. Do not run `db:seed` after reset. It creates a temporary Wrangler config with the starter `DB` binding and placeholder ID, always passes `--local`, and never applies remote migrations.

The SQL migration is hand-reviewed at `drizzle/0001_returnops.sql`. `db/schema.ts` is intentionally empty; do not regenerate this migration with Drizzle. Seed fixtures come from `scripts/demo-data.ts` and match `docs/scenarios.md`.

## Identity and secrets

For a local Worker, put server-only values in `.dev.vars`. Hosted Sites values belong in protected secrets/vars. The repository environment template documents names only. The Worker does not load `.env` automatically.

Set `SITES_IDENTITY_VERIFIED=true` only after confirming Sites protected ingress is the only path to the Worker. The API requires both Sites user ID and email headers. By default it checks comma-separated `OWNER_USER_IDS` and `MEMBER_USER_IDS`, returning 401/403 before data access when trust is missing or unauthorized. For the shared link-access demo, explicitly set `RETURNOPS_SIGNED_IN_DEMO=true` after ingress verification; every verified signed-in identity then receives the synthetic demo OWNER role and uses the shared D1 fixtures. Anonymous requests remain 401. Keep the flag unset/false for the original allowlist behavior.

## Provider probe and smoke

`npm run probe:openai` performs an explicit two-round Responses function-calling probe with `gpt-5.6-terra`. It prints only status, model, tool count, rounds, and a provider response ID; it never prints the API key or raw response.

The opt-in `scripts/smoke-live.ts` path uses synthetic local D1 data and a private harness identity to exercise A–E through the real provider. It checks proof resume, separate rule acceptance and fresh E provenance, C flags/no learning, one simulated receipt per case, A replay, and restart persistence. It is not a hosted identity or deployment check.

Run the provider checks explicitly; they read a configured key from process environment or the local `.env` file:

```sh
npm run probe:openai
npm run smoke:live
```

## Runtime failure handling

OpenAI calls have a total 30-second deadline, at most eight tool calls, and at most nine rounds. Unknown tools, invalid arguments, refusals, provider errors, missing key/model, and timeouts fail closed. The EVALUATION records technical failure; the original REQUEST acknowledgement is immutable. A retry with the same key replays that acknowledgement. Terminal failure needs a new explicit evaluation key and current versions.

Evidence review and evaluation use guarded D1 batches. A stale case/evidence/order/rule snapshot, expired lease, or expired policy window aborts the whole domain mutation. Owner technical recovery is manual and simulated and never creates a learned rule.

## Deployment evidence

### Hosted fixture initialization (historical)

The temporary `POST /api/operator/initialize` route was used once against the
dedicated hosted D1 database during version 2 provisioning. It required a
server-only `RETURNOPS_INITIALIZE_SECRET` (at least 32 characters), a bearer
token, same-origin `Origin`, JSON content type, and
`{"confirm":"initialize-synthetic-demo"}`. It never impersonated an
OWNER/MEMBER and never reset partial data.

The route and initializer secret were removed before version 3. Do not restore
the route or rerun initialization on the existing database. The helper and
regression tests remain in source for review only.

After verifying protected ingress, `GET /api/identity` lets a signed-in visitor
see their own Site-scoped ID. It does not return credentials. In shared demo
mode the identity is used for audit/replay but does not need to appear in an
allowlist; with the flag disabled, API access still requires the original
allowlists and verified identity configuration.

The current verified Site release is version 5/runtime revision 6 with public
link audience and ChatGPT sign-in required. A genuine signed-in session with
no configured allowlists reached the queue, created a new C intake, and
completed owner-only carrier review. Anonymous root access redirected to
sign-in and anonymous/spoofed API requests returned 401. The prepared C run
completed LIVE with `gpt-6.1-terra` as `NEEDS_OWNER_REVIEW`, three risk flags,
and no receipt. The final manual reset leaves five fresh `NEW` cases with no
evaluations or receipts and catalog version 1.

### Shared demo refresh

When `RETURNOPS_SIGNED_IN_DEMO=true`, the UI's **Làm mới dữ liệu demo** action
calls `POST /api/demo/reset`. It requires a verified signed-in demo OWNER,
same-origin JSON, an idempotency key, and the exact confirmation body
`{"confirm":"reset-shared-demo"}`. The request is global and irreversible:
one atomic D1 batch removes workflow history and learned rules, fences old
versions, and recreates five `NEW` synthetic A–E cases with catalog version 1.
Reset acknowledgements remain in the ledger across later resets, preventing a
stale retry from deleting fresh progress. Canceling the UI confirmation is a
no-op. This route returns 404 for authenticated callers outside shared mode;
anonymous callers are rejected with 401. Never replace it with a remote CLI,
schema drop/reseed, or initializer.

Local D1 output does not establish hosted D1 persistence, Sites identity
attestation, Site audience, judge access, or production secrets. The current
Site verification and the shared link-access rollout procedure are recorded in
[deployment.md](./deployment.md).
Do not publish or migrate remotely from these local commands. The hosted refresh
button above is the only supported shared-database reset.
