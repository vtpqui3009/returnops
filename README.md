# ReturnOps

For Issue #11, Nhân owns UI/API integration, backend coordination, and the private hosted handoff; Khoa owns #13 QA and packaging; Quí retains original UI authorship and receives approved #12 pitch/demo evidence only.

ReturnOps is a one-shop simulated return/refund workflow built with Vinext, Cloudflare Workers, and D1. The backend implements the shared A–E contract, guarded mutations, bounded OpenAI Responses calls, owner learning review, and metadata-only proof. Receipts, packets, and replies are always `SIMULATED`.

## Stack and scope

- Sites/Vinext starter with `sites()` in `vite.config.ts`.
- D1 binding `DB`; reviewed SQL migration authority in `drizzle/0001_returnops.sql`.
- Shared wire types in `src/shared/contracts.ts`; API handlers in `src/server/` and route adapters in `app/api/`.
- OpenAI Responses API only. Approved model: `gpt-5.6-terra`, configurable through `OPENAI_MODEL`.
- No R2, payment, buyer messaging, marketplace submission, or real customer data.

The scaffold comes from Sites plugin 1.1.2 `vinext-starter` (Vinext 1.0.0-beta.5). The brainstorm context and plan were prepared earlier; backend code and tests were authored in this implementation session. No rehearsal implementation was copied.

Nhân owns server/API, shared types, migrations, seed/reset and initial package/build configuration. Quí owns UI; Khoa owns integration/E2E and deployment configuration after explicit handoff. This session does not change that ownership.

## Install and verify

Requires Node.js 22.13.0 or newer and npm.

```sh
npm run install:ci
npm run build
npx tsc --noEmit
npm run lint
npm test
```

Local checks pass. The A LIVE smoke passed in an isolated local harness; B–E provider-backed workflow, hosted deployment, protected identity access, UI integration, and judge access remain separate evidence items.

## Local D1

These commands use a fixed local-only Wrangler configuration and persist to `.wrangler/state`. They do not accept a remote target. Reset is explicit and requires its confirmation flag.

```sh
npm run db:migrate
npm run db:seed
npm run db:reset -- --confirm-local-reset
```

`db/schema.ts` is intentionally empty: the reviewed hand-authored migration is the schema authority, so `db:generate` is not part of the backend workflow. A reset clears and re-seeds the same synthetic fixtures; do not run `db:seed` again after reset. The fixtures are described in `docs/scenarios.md`.

## Server configuration

Copy the names from the repository environment template into server-side `.dev.vars` for local Worker runs or Sites secrets/vars when hosted. The Worker does not automatically read `.env`; the provider probe and isolated smoke script read it only as an explicit CLI convenience.

Set `SITES_IDENTITY_VERIFIED=true` only after confirming protected Sites ingress strips public header spoofing. Configure `OWNER_USER_IDS` and `MEMBER_USER_IDS` server-side. Missing trust or allowlists fail closed. Never commit keys, user IDs, or environment files.

Agent limits are eight tool calls, nine model rounds, and 30 seconds. Registered tools are `read_order`, `check_policy`, `list_missing_evidence`, `draft_reply`, and `escalate`.

## API behavior

See `docs/api-contract.md` for routes, payloads, errors, proof rules, idempotent replay, and D/E learning. Every mutation requires same-origin `Origin`, JSON, and an `Idempotency-Key`; unknown fields are rejected. A failed evaluation is visible on GET detail while its original 201/202 acknowledgement remains immutable.

## Evidence status

### Current Issue #11 baseline

The current uncommitted Issue #11 worktree passed root and QA typechecks, 27/27 Node tests, 22/22 UI checks, and 10/10 QA harness checks. Lint has two non-blocking anonymous-default-export warnings in local test adapters. A provider model setting is present in the ignored local environment, but Worker binding and real-route provider execution remain unverified. No full-route browser or hosted result is claimed here. Details: `plans/reports/test-261031-1352-GH-11-baseline-report.md`.

The provider tool-calling probe and isolated local A LIVE smoke passed with `gpt-5.6-terra`; the smoke recorded simulated receipt, replay, and restart persistence. Local D1 migration, seed, reset, build, typecheck, lint, and automated tests passed in this branch. Hosted identity, hosted D1 persistence, UI/API integration, and judge access are not claimed until independently exercised.

Phase 1 baseline was merged in commit `92430915e529ae12f0a7ed5c4b2842d771498e86`; this implementation continues on `feat/nhan-agent`. See Issue #2.

## UI review (issue #1)

The four-screen UI defaults to clearly labelled TEST mock data for team review. See the [UI run guide and acceptance checklist](docs/ui-handoff.md) and [validation evidence](docs/ui-validation.md). Server Worker binding `RETURNOPS_UI_MODE=api` selects the separate same-origin HTTP adapter. Mock/browser-harness success does not establish real UI/API, D1 or LIVE acceptance.
