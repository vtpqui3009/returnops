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

Set `SITES_IDENTITY_VERIFIED=true` only after confirming Sites protected ingress is the only path to the Worker. Then configure comma-separated `OWNER_USER_IDS` and `MEMBER_USER_IDS`. The API requires both Sites user ID and email headers, checks the allowlists, and returns 401/403 before data access when trust is missing or unauthorized.

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

Local D1 output does not establish hosted D1 persistence, Sites identity attestation, private audience, judge access, or production secrets. Record those checks separately after a single authorized Site is configured. Do not publish or migrate remotely from these local commands.
